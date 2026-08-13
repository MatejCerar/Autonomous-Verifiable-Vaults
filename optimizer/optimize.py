#!/usr/bin/env python3
"""
AVV allocation optimizer (reference implementation).

Reference Python implementation of the same math as optimize.ts. It exists to
double-check the TypeScript solver and to make the equation runnable on its own.

Math: see EQUATION.md. Summary:
  - each Morpho-style market has a diminishing supply-yield curve r_i(d_i) driven
    by utilization u_i(d_i) = B_i / (S_i + d_i) through an AdaptiveCurveIrm-style
    piecewise-linear borrow rate,
  - objective J(w) = sum_i w_i r_i(w_i C) - (lambda/2) w^T Sigma w,
  - constraints: budget, per-venue cap, total-out cap, reserve floor, liquidity,
  - solved by projected gradient ascent with exact water-filling projection.

numpy is used ONLY for the linear-algebra convenience of the covariance product;
a pure-Python fallback is provided so the script runs with a bare interpreter.

No emojis, no em dashes (house style).
"""

import json
import math
import os
import sys
from typing import Dict, List, Optional

try:
    import numpy as _np  # optional
    _HAVE_NUMPY = True
except Exception:  # pragma: no cover - environment dependent
    _np = None
    _HAVE_NUMPY = False


# --------------------------------------------------------------------------- #
# Defaults (mirror optimize.ts DEFAULT_PARAMS and tee-model/config.ts)
# --------------------------------------------------------------------------- #
DEFAULT_PARAMS = {
    "capital": 1_000_000.0,   # USD notional C
    "cap": 0.30,              # per-venue weight cap
    "maxTotalOut": 0.80,      # cap on sum of deployed weights
    "reserveFloor": 0.20,     # minimum reserve weight
    "lam": 0.10,              # risk aversion lambda (calibrated: see EQUATION.md sec 6)
    "reserveApy": 0.0,        # yield on the reserve sink
    # IRM shape (AdaptiveCurveIrm). Matches the research worker's spec:
    # curveSteepness s means borrowRate = rateAtTarget * ( (u/u*)*(1-1/s) + 1/s )
    # for u <= u* (rises from rateAtTarget/s at u=0 to rateAtTarget at u=u*), and
    # rateAtTarget * (1 + (s-1)*((u-u*)/(1-u*))) for u > u* (rises to s*rateAtTarget
    # at u=1). rateAtTarget is CALIBRATED per venue so the model reproduces the
    # reported supplyApy at the reported utilization (anchors curve to live data).
    "uTarget": 0.90,          # kink utilization u*
    "curveSteepness": 4.0,    # s (from research irm.curveSteepness)
    "rateAtTarget": 0.05,     # fallback rateAtTarget if calibration not possible
    "defaultFee": 0.0,        # supply APY in research is already net of perf fee
    "depegVol": 0.02,         # volatility floor for stablecoin depeg tail
    # solver
    "iterations": 3000,       # gradient ascent to fix the active set; polish finishes
    "step0": 1.0,             # initial gradient step (grad scale ~0.05)
}

# venueId is index-aligned with the on-chain adapter order (see inputs.ts):
# FXRP=0, USDT0=1, WFLR=2. The SAMPLE correlation matrix uses that same order.
#
# Labeled SAMPLE market snapshot. NOT live data. Used when research/market-data.json
# is absent. Fields mirror the research worker schema.
SAMPLE_MARKET_DATA = {
    "asOf": "SAMPLE",
    "dataSource": "SAMPLE",
    "chainId": 14,
    "assets": {
        "FXRP": {
            "venueId": 0, "decimals": 6, "priceUsd": 0.50,
            "totalBorrowAssets": 3_200_000.0, "totalSupplyAssets": 4_000_000.0,
            "utilization": 0.80, "availableLiquidity": 800_000.0,
            "annualizedVol": 0.55, "performanceFee": 0.10,
        },
        "USDT0": {
            "venueId": 1, "decimals": 6, "priceUsd": 1.00,
            "totalBorrowAssets": 7_200_000.0, "totalSupplyAssets": 8_000_000.0,
            "utilization": 0.90, "availableLiquidity": 800_000.0,
            "annualizedVol": 0.00, "performanceFee": 0.10,
        },
        "WFLR": {
            "venueId": 2, "decimals": 18, "priceUsd": 0.020,
            "totalBorrowAssets": 1_800_000.0, "totalSupplyAssets": 3_000_000.0,
            "utilization": 0.60, "availableLiquidity": 1_200_000.0,
            "annualizedVol": 0.70, "performanceFee": 0.10,
        },
    },
    # correlation matrix, order = [FXRP, USDT0, WFLR]
    "correlation": [
        [1.00, 0.10, 0.45],
        [0.10, 1.00, 0.05],
        [0.45, 0.05, 1.00],
    ],
}


# --------------------------------------------------------------------------- #
# Yield-curve model
# --------------------------------------------------------------------------- #
def borrow_rate(u: float, rate_at_target: float, p: dict) -> float:
    """AdaptiveCurveIrm piecewise-linear borrow rate (eq. 2 in EQUATION.md),
    parameterized by curveSteepness s and rateAtTarget (per venue)."""
    u = max(0.0, min(1.0, u))
    ut = p["uTarget"]
    s = p["curveSteepness"]
    if u <= ut:
        # rises from rateAtTarget/s at u=0 to rateAtTarget at u=ut
        frac = (u / ut) if ut > 0 else 0.0
        return rate_at_target * (frac * (1.0 - 1.0 / s) + 1.0 / s)
    # rises from rateAtTarget at u=ut to s*rateAtTarget at u=1
    frac = ((u - ut) / (1.0 - ut)) if ut < 1.0 else 0.0
    return rate_at_target * (1.0 + (s - 1.0) * frac)


def supply_rate(deposit_usd: float, v: dict, p: dict) -> float:
    """Post-deposit supply APY r_i(d_i) (eq. 3). Decreasing in deposit_usd.
    v is a normalized venue dict with keys B, S (USD), fee, rateAtTarget."""
    denom = v["S"] + max(0.0, deposit_usd)
    u = (v["B"] / denom) if denom > 0 else 0.0
    return borrow_rate(u, v["rateAtTarget"], p) * u * (1.0 - v["fee"])


def calibrate_rate_at_target(u0: float, observed_supply_apy: float,
                             fee: float, p: dict) -> float:
    """Solve for rateAtTarget so supply APY at current utilization u0 (with zero
    extra deposit) equals the reported supplyApy. supply APY is linear in
    rateAtTarget, so this is a single division. Anchors the curve to live data."""
    unit = borrow_rate(u0, 1.0, p) * u0 * (1.0 - fee)  # supply APY at rateAtTarget=1
    if unit <= 0:
        return p["rateAtTarget"]
    return observed_supply_apy / unit


def yield_contribution(w_i: float, v: dict, C: float, p: dict) -> float:
    """Return w_i * r_i(w_i C): venue i's contribution to portfolio APY (a fraction
    of C), eq. 5 term. Working in fraction-of-C units keeps the mean term and the
    variance penalty (lambda/2) w^T Sigma w in the same dimensionless units, so
    lambda is a meaningful trade-off. Realized USD yield is this times C."""
    d = w_i * C
    return w_i * supply_rate(d, v, p)


def marginal_yield(w_i: float, v: dict, C: float, p: dict) -> float:
    """m_i(w_i) = d/dw_i [ w_i r_i(w_i C) ] via central finite difference (eq. 7).
    Dimensionless (per unit weight), directly comparable to lambda*(Sigma w)_i."""
    h = 1e-6
    hi = yield_contribution(w_i + h, v, C, p)
    lo = yield_contribution(max(0.0, w_i - h), v, C, p)
    return (hi - lo) / (2.0 * h)


# --------------------------------------------------------------------------- #
# Linear-algebra helpers (numpy if present, else pure python)
# --------------------------------------------------------------------------- #
def cov_times(Sigma: List[List[float]], w: List[float]) -> List[float]:
    """Return Sigma @ w."""
    if _HAVE_NUMPY:
        return list(_np.array(Sigma).dot(_np.array(w)))
    n = len(w)
    return [sum(Sigma[i][j] * w[j] for j in range(n)) for i in range(n)]


def quad_form(Sigma: List[List[float]], w: List[float]) -> float:
    """Return w^T Sigma w."""
    Sw = cov_times(Sigma, w)
    return sum(w[i] * Sw[i] for i in range(len(w)))


# --------------------------------------------------------------------------- #
# Projection onto F = { 0 <= w_i <= capp_i, sum_i w_i <= T }  (water-filling)
# --------------------------------------------------------------------------- #
def project(w: List[float], capp: List[float], T: float) -> List[float]:
    # 1. clip to box
    x = [min(capp[i], max(0.0, w[i])) for i in range(len(w))]
    if sum(x) <= T + 1e-15:
        return x
    # 2. subtract a common water level tau from unclamped coords until sum == T.
    #    bisection on tau in [0, max(w)].
    lo, hi = 0.0, max(x) if x else 0.0
    for _ in range(200):
        tau = 0.5 * (lo + hi)
        s = sum(min(capp[i], max(0.0, x[i] - tau)) for i in range(len(x)))
        if s > T:
            lo = tau
        else:
            hi = tau
    tau = hi
    return [min(capp[i], max(0.0, x[i] - tau)) for i in range(len(x))]


# --------------------------------------------------------------------------- #
# Solver: projected gradient ascent
# --------------------------------------------------------------------------- #
def _risk_adj_marginal(i, w, venues, Sigma, C, p):
    Sw_i = sum(Sigma[i][j] * w[j] for j in range(len(w)))
    return marginal_yield(w[i], venues[i], C, p) - p["lam"] * Sw_i


def _polish(w, venues, capp, Sigma, C, T, p):
    """Exact active-set water-filling polish. Fixes the clamped/excluded set from
    the gradient iterate, then equalizes the risk-adjusted marginal yield across
    interior venues at a common water line nu (bisection), with the interior
    weights themselves solved by a nested bisection since g_i is monotone
    decreasing in w_i. Re-checks KKT and repeats if the active set changes."""
    n = len(w)
    tol = 5e-4
    for _ in range(20):
        clamped = [i for i in range(n) if w[i] >= capp[i] - tol]
        excluded = [i for i in range(n) if w[i] <= tol]
        interior = [i for i in range(n) if i not in clamped and i not in excluded]
        wnew = [0.0] * n
        for i in clamped:
            wnew[i] = capp[i]
        budget_left = T - sum(capp[i] for i in clamped)
        if budget_left < 0:
            budget_left = 0.0

        if interior:
            # For a trial water line nu, each interior venue picks w_i in [0, cap]
            # so that g_i(w) = nu (or clamps). Because g_i depends on w through the
            # covariance cross-terms too, iterate: hold others fixed, solve each.
            def interior_weight_for_nu(i, wcur, nu):
                lo, hi = 0.0, capp[i]
                for _ in range(80):
                    mid = 0.5 * (lo + hi)
                    wtmp = list(wcur); wtmp[i] = mid
                    g = _risk_adj_marginal(i, wtmp, venues, Sigma, C, p)
                    if g > nu:      # wants more capital
                        lo = mid
                    else:
                        hi = mid
                return hi

            # bisection on the water line nu so the interior weights sum to
            # budget_left. The water line is FLOORED at reserveApy: capital is only
            # deployed while its risk-adjusted marginal yield beats the reserve's
            # yield. If even at nu = reserveApy the interior venues want less than
            # budget_left, we stop there and the remainder stays in reserve (the
            # optimum can leave budget undeployed when marginal yields turn negative).
            nu_floor = p["reserveApy"]
            nu_lo, nu_hi = nu_floor, 1.0
            wtrial = list(wnew)
            for _ in range(120):
                nu = 0.5 * (nu_lo + nu_hi)
                wtrial = list(wnew)
                # a few Gauss-Seidel sweeps to resolve cross-coupling
                for _sweep in range(30):
                    for i in interior:
                        wtrial[i] = interior_weight_for_nu(i, wtrial, nu)
                s = sum(wtrial[i] for i in interior)
                if s > budget_left:   # too much deployed, raise the water line
                    nu_lo = nu
                else:
                    nu_hi = nu
            # Take the solution at the water-line floor if the budget does not bind.
            wtrial = list(wnew)
            for _sweep in range(30):
                for i in interior:
                    wtrial[i] = interior_weight_for_nu(i, wtrial, nu_floor)
            if sum(wtrial[i] for i in interior) <= budget_left:
                for i in interior:
                    wnew[i] = wtrial[i]   # budget slack: fill only to the floor
            else:
                # budget binds: use the bisection result at nu = nu_hi
                wtrial = list(wnew)
                for _sweep in range(30):
                    for i in interior:
                        wtrial[i] = interior_weight_for_nu(i, wtrial, nu_hi)
                for i in interior:
                    wnew[i] = wtrial[i]

        # KKT re-check: does any clamped venue actually want less (g < nu)?
        # or any excluded venue want in (g > nu)? If so, move it to interior.
        changed = False
        if interior:
            nu_star = max(_risk_adj_marginal(i, wnew, venues, Sigma, C, p)
                          for i in interior)
        else:
            nu_star = p["reserveApy"]
        # a clamped-at-cap venue is only justified if its marginal beats the water
        # line AND the reserve; a below-reserve marginal must be released.
        nu_star = max(nu_star, p["reserveApy"])
        for i in clamped:
            if _risk_adj_marginal(i, wnew, venues, Sigma, C, p) < nu_star - 1e-6:
                w = list(wnew); w[i] = capp[i] - 2 * tol; changed = True
                break
        if not changed:
            for i in excluded:
                if _risk_adj_marginal(i, wnew, venues, Sigma, C, p) > nu_star + 1e-6:
                    w = list(wnew); w[i] = 2 * tol; changed = True
                    break
        if not changed:
            return _refine(wnew, venues, capp, Sigma, C, T, p)
        w = wnew
    return _refine(w, venues, capp, Sigma, C, T, p)


def _objective(w, venues, Sigma, C, p):
    R = sum(yield_contribution(w[i], venues[i], C, p) for i in range(len(w)))
    q = sum(w[i] * sum(Sigma[i][j] * w[j] for j in range(len(w)))
            for i in range(len(w)))
    return R - 0.5 * p["lam"] * q


def _scan_max_1d(f, lo, hi, samples):
    """Return the argmax of f on [lo, hi] by a dense uniform scan plus a local
    refinement around the best sample. Robust to kinks and boundary maxima (unlike
    golden section, which assumes a smooth interior optimum). Deterministic."""
    if hi - lo < 1e-15:
        return lo
    best_x, best_f = lo, f(lo)
    for k in range(1, samples + 1):
        x = lo + (hi - lo) * k / samples
        fx = f(x)
        if fx > best_f:
            best_f, best_x = fx, x
    # local refinement: shrink to the two neighbours around best_x and re-scan
    h = (hi - lo) / samples
    a2, b2 = max(lo, best_x - h), min(hi, best_x + h)
    for k in range(samples + 1):
        x = a2 + (b2 - a2) * k / samples
        fx = f(x)
        if fx > best_f:
            best_f, best_x = fx, x
    return best_x


def _refine(w, venues, capp, Sigma, C, T, p):
    """Final exact refinement by budget-feasible coordinate ascent that only ever
    ACCEPTS improving moves, so it cannot worsen the solution and reaches the
    constrained optimum (the problem is concave: PD covariance + concave, piecewise
    diminishing-yield mean). Two budget-feasible move families, each maximized by a
    robust dense 1-D scan (kink- and boundary-safe):

      (1) single-coordinate: raise/lower w_i within [0, cap_i] using the slack
          between sum(w) and T (deploy more, or return capital to reserve),
      (2) pairwise transfer: shift capital between venues i and j (budget-neutral),
          which repairs any mislabeled active set from the warm start.
    """
    n = len(w)
    w = list(w)
    samples = p.get("scanSamples", 200)

    def clamp(x, i):
        return min(capp[i], max(0.0, x))

    for _ in range(200):
        base = _objective(w, venues, Sigma, C, p)
        slack = T - sum(w)

        # (1) single-coordinate moves.
        for i in range(n):
            lo = 0.0
            hi = min(capp[i], w[i] + max(0.0, slack))

            def f1(x, i=i):
                w[i] = clamp(x, i)
                return _objective(w, venues, Sigma, C, p)

            xstar = _scan_max_1d(f1, lo, hi, samples)
            w[i] = clamp(xstar, i)
            slack = T - sum(w)

        # (2) pairwise budget-neutral transfers.
        for i in range(n):
            for j in range(i + 1, n):
                wi0, wj0 = w[i], w[j]
                t_max = min(capp[i] - wi0, wj0)
                t_min = -min(capp[j] - wj0, wi0)
                if t_max - t_min < 1e-15:
                    continue

                def ft(t, i=i, j=j, wi0=wi0, wj0=wj0):
                    w[i] = clamp(wi0 + t, i)
                    w[j] = clamp(wj0 - t, j)
                    return _objective(w, venues, Sigma, C, p)

                tstar = _scan_max_1d(ft, t_min, t_max, samples)
                ft(tstar)

        if _objective(w, venues, Sigma, C, p) - base <= 1e-12:
            break
    return w


def normalize_market_data(market_data: dict, p: dict, C: float):
    """Convert either the research worker schema (assets as a LIST, correlation
    under pairwiseCorrelation.matrix, supplyApy + utilization + availableLiquidityUsd)
    OR the built-in SAMPLE (assets as a DICT with explicit totalBorrow/Supply) into
    a canonical list of venue dicts. Missing fields degrade gracefully with a
    labeled assumption. Returns (venues, Sigma, symbols, assumptions).

    Each venue dict has: symbol, venueId, decimals, priceUsd, B, S (USD borrow /
    supply), fee, capp (cap tightened by liquidity), liqUsd, vol, rateAtTarget,
    observedApy, capIsLiquidity (bool)."""
    assumptions: List[str] = []

    # --- unpack assets into a symbol-keyed list, preserving order ---
    raw = market_data.get("assets", {})
    if isinstance(raw, dict):
        items = sorted(raw.items(), key=lambda kv: kv[1].get("venueId", 0))
        assets = [dict(v, symbol=k) for k, v in items]
    else:  # research schema: list of dicts each with "symbol"
        assets = list(raw)
    n = len(assets)
    symbols = [a["symbol"] for a in assets]

    # --- IRM shape from research if present ---
    irm = market_data.get("irm", {})
    if "targetUtilization" in irm:
        p = dict(p, uTarget=float(irm["targetUtilization"]))
    if "curveSteepness" in irm:
        p = dict(p, curveSteepness=float(irm["curveSteepness"]))

    venues = []
    for idx, a in enumerate(assets):
        sym = a["symbol"]
        util = a.get("utilization")
        # available liquidity in USD (research: availableLiquidityUsd; sample: availableLiquidity)
        liq_usd = a.get("availableLiquidityUsd", a.get("availableLiquidity"))
        # supply/borrow in USD. Prefer explicit fields; else derive from util + tvl.
        B = a.get("totalBorrowAssets")
        S = a.get("totalSupplyAssets")
        if (B is None or S is None):
            tvl = a.get("tvlUsd")
            if util is not None and tvl is not None:
                # tvl ~ supplied USD S; borrowed = util * S.
                S = float(tvl)
                B = float(util) * S
                assumptions.append(f"{sym}: B,S(USD) derived from utilization*tvlUsd")
            elif util is not None and liq_usd is not None:
                u = float(util)
                S = float(liq_usd) / max(1e-9, (1.0 - u))
                B = u * S
                assumptions.append(f"{sym}: B,S(USD) derived from utilization+availableLiquidity")
            else:
                S = float(liq_usd) if liq_usd else 1.0
                B = 0.0
                assumptions.append(f"{sym}: missing borrow/supply, assumed idle market")
        B, S = float(B), float(S)
        if util is None:
            util = (B / S) if S > 0 else 0.0

        fee = float(a.get("fee", a.get("performanceFee", p["defaultFee"])))
        # research supplyApy is already NET of the performance fee, so do not
        # re-apply the fee when calibrating; use fee=0 for the model in that case.
        observed_apy = a.get("supplyApy")
        if observed_apy is None:
            observed_apy = a.get("supplyApyOnchainComputed")
        model_fee = 0.0 if observed_apy is not None else fee

        # Calibrate rateAtTarget so the model reproduces the observed supply APY at
        # the current utilization. If no observed APY, fall back to default.
        if observed_apy is not None:
            rate_at_target = calibrate_rate_at_target(
                float(util), float(observed_apy), model_fee, p
            )
        else:
            rate_at_target = p["rateAtTarget"]
            assumptions.append(f"{sym}: no observed supplyApy, used default rateAtTarget")

        vol = a.get("annualizedVol")
        if vol is None:
            vol = 0.0
            assumptions.append(f"{sym}: missing annualizedVol, assumed 0")
        vol = float(vol)
        if vol < p["depegVol"]:
            vol = p["depegVol"]  # depeg tail floor for stablecoin-like legs

        # per-venue cap, tightened by market depth (liquidity)
        cap_i = p["cap"]
        cap_is_liq = False
        if liq_usd is not None and C > 0:
            liq_cap = float(liq_usd) / C
            if liq_cap < cap_i:
                cap_i = liq_cap
                cap_is_liq = True

        venues.append({
            "symbol": sym,
            "venueId": int(a.get("venueId", idx)),
            "decimals": int(a.get("decimals", 18)),
            "priceUsd": float(a.get("priceUsd", 0.0)),
            "B": B, "S": S, "fee": model_fee,
            "capp": cap_i, "liqUsd": (float(liq_usd) if liq_usd is not None else None),
            "capIsLiquidity": cap_is_liq,
            "vol": vol, "rateAtTarget": rate_at_target,
            "observedApy": (float(observed_apy) if observed_apy is not None else None),
        })

    # --- correlation matrix ---
    corr = None
    pc = market_data.get("pairwiseCorrelation")
    if isinstance(pc, dict) and "matrix" in pc:
        order = pc.get("order")
        m = pc["matrix"]
        if order and len(order) == n:
            # reorder to match our symbol order
            pos = {s: i for i, s in enumerate(order)}
            corr = [[m[pos[symbols[i]]][pos[symbols[j]]] for j in range(n)]
                    for i in range(n)]
        else:
            corr = m
    elif "correlation" in market_data:
        corr = market_data["correlation"]
    if corr is None or len(corr) != n:
        corr = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
        assumptions.append("missing/mismatched correlation matrix, assumed identity")

    vols = [v["vol"] for v in venues]
    Sigma = [[corr[i][j] * vols[i] * vols[j] for j in range(n)] for i in range(n)]

    return venues, Sigma, symbols, assumptions, p


def optimize(market_data: dict, params: Optional[dict] = None) -> dict:
    p = dict(DEFAULT_PARAMS)
    if params:
        p.update(params)
    C = p["capital"]

    venues, Sigma, symbols, assumptions, p = normalize_market_data(market_data, p, C)
    n = len(venues)
    capp = [v["capp"] for v in venues]

    # Active deployment budget.
    T = min(p["maxTotalOut"], 1.0 - p["reserveFloor"])

    # Projected gradient ascent from w = 0 to identify the active set.
    w = [0.0] * n
    for k in range(int(p["iterations"])):
        step = p["step0"] / (1.0 + 0.0005 * k)  # gentle decay
        Sw = cov_times(Sigma, w)
        grad = [
            marginal_yield(w[i], venues[i], C, p) - p["lam"] * Sw[i]
            for i in range(n)
        ]
        w = project([w[i] + step * grad[i] for i in range(n)], capp, T)

    # Polish: gradient ascent identifies the correct active set but approaches the
    # boundary sublinearly. Snap the active set and solve the interior water-filling
    # exactly (bisection on the water line nu), then verify KKT. Lands to ~1e-9.
    w = _polish(w, venues, capp, Sigma, C, T, p)

    reserve = 1.0 - sum(w)
    if reserve < p["reserveFloor"] - 1e-9:
        reserve = p["reserveFloor"]

    # Reporting. yield_contribution is a fraction of C, so the sum is portfolio APY.
    expected_apy = (
        sum(yield_contribution(w[i], venues[i], C, p) for i in range(n))
        + reserve * p["reserveApy"]
    )
    risk_pen = 0.5 * p["lam"] * quad_form(Sigma, w)
    risk_adj_apy = expected_apy - risk_pen

    # Per-venue detail + binding constraint classification.
    tol = 5e-4
    per_venue = []
    nu = None
    Sw = cov_times(Sigma, w)
    for i in range(n):
        g = marginal_yield(w[i], venues[i], C, p) - p["lam"] * Sw[i]
        if tol < w[i] < capp[i] - tol:
            nu = g if nu is None else max(nu, g)
    for i in range(n):
        v = venues[i]
        d_usd = w[i] * C
        g = marginal_yield(w[i], v, C, p) - p["lam"] * Sw[i]
        if w[i] <= tol:
            binding = "excluded (below water line)"
        elif w[i] >= capp[i] - tol:
            binding = "liquidity" if v["capIsLiquidity"] else "venue cap"
        else:
            binding = "interior (on water line)"
        token_amount = (d_usd / v["priceUsd"]) if v["priceUsd"] > 0 else 0.0
        per_venue.append({
            "symbol": v["symbol"],
            "venueId": v["venueId"],
            "weight": round(w[i], 8),
            "amountUsd": round(d_usd, 2),
            "tokenAmount": round(token_amount, 6),
            "decimals": v["decimals"],
            "supplyApyPostDeposit": round(supply_rate(d_usd, v, p), 6),
            "marginalYield": round(g, 8),
            "bindingConstraint": binding,
        })

    rationale = build_rationale(per_venue, reserve, p, T, assumptions)

    return {
        "asOf": market_data.get("asOf", "SAMPLE"),
        "chainId": market_data.get("chainId", 14),
        "dataSource": market_data.get("dataSource", "SAMPLE"),
        "capital": C,
        "params": {
            "cap": p["cap"], "maxTotalOut": p["maxTotalOut"],
            "reserveFloor": p["reserveFloor"], "lambda": p["lam"],
            "reserveApy": p["reserveApy"], "uTarget": p["uTarget"],
            "curveSteepness": p["curveSteepness"],
        },
        "weights": {symbols[i]: round(w[i], 8) for i in range(n)},
        "reserve": round(reserve, 8),
        "expectedApy": round(expected_apy, 6),
        "expectedRiskAdjApy": round(risk_adj_apy, 6),
        "perVenue": per_venue,
        "waterLine": round(nu, 8) if nu is not None else None,
        "assumptions": assumptions,
        "rationale": rationale,
    }


def build_rationale(per_venue, reserve, p, T, assumptions) -> str:
    clamped = [v["symbol"] for v in per_venue if v["bindingConstraint"] in ("venue cap", "liquidity")]
    interior = [v["symbol"] for v in per_venue if v["bindingConstraint"].startswith("interior")]
    excluded = [v["symbol"] for v in per_venue if v["bindingConstraint"].startswith("excluded")]
    parts = []
    parts.append(
        f"Maximized risk-adjusted yield (lambda={p['lam']}) by water-filling: "
        f"funded venues equalize risk-adjusted marginal yield up to their caps."
    )
    if clamped:
        parts.append(f"Clamped at cap/liquidity: {', '.join(clamped)}.")
    if interior:
        parts.append(f"Interior (sit on the water line): {', '.join(interior)}.")
    if excluded:
        parts.append(f"Excluded (below water line): {', '.join(excluded)}.")
    parts.append(
        f"Reserve = {reserve:.2%} (floor {p['reserveFloor']:.0%}); "
        f"total deployed budget T = {T:.0%}."
    )
    if assumptions:
        parts.append("Assumptions: " + "; ".join(assumptions) + ".")
    return " ".join(parts)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def load_market_data() -> dict:
    here = os.path.dirname(os.path.abspath(__file__))
    research = os.path.join(here, "..", "research", "market-data.json")
    if os.path.exists(research):
        with open(research, "r") as f:
            md = json.load(f)
        md.setdefault("dataSource", "research/market-data.json")
        print(f"[optimize] loaded real market data from {research}")
        return md
    print("[optimize] research/market-data.json not found, using built-in SAMPLE")
    return SAMPLE_MARKET_DATA


def print_table(res: dict) -> None:
    print()
    print(f"asOf={res['asOf']}  chainId={res['chainId']}  dataSource={res['dataSource']}")
    print(f"capital=${res['capital']:,.0f}  lambda={res['params']['lambda']}")
    print(f"{'venue':6} {'weight':>8} {'amountUsd':>14} {'tokenAmt':>16} "
          f"{'supplyAPY':>10} {'margYield':>11}  binding")
    for v in res["perVenue"]:
        print(f"{v['symbol']:6} {v['weight']:>8.4f} {v['amountUsd']:>14,.2f} "
              f"{v['tokenAmount']:>16,.4f} {v['supplyApyPostDeposit']*100:>9.3f}% "
              f"{v['marginalYield']:>11.6f}  {v['bindingConstraint']}")
    print(f"{'RESERVE':6} {res['reserve']:>8.4f} "
          f"{res['reserve']*res['capital']:>14,.2f}")
    print(f"\nexpectedApy         = {res['expectedApy']*100:.4f}%")
    print(f"expectedRiskAdjApy  = {res['expectedRiskAdjApy']*100:.4f}%")
    print(f"waterLine (nu)      = {res['waterLine']}")
    s = sum(res["weights"].values()) + res["reserve"]
    print(f"\nconstraint check: sum(weights)+reserve = {s:.10f} (want 1.0)")
    print(f"                  reserve >= floor: {res['reserve'] >= res['params']['reserveFloor'] - 1e-9}")
    caps_ok = all(v["weight"] <= res["params"]["cap"] + 1e-9 for v in res["perVenue"])
    print(f"                  all weights <= cap: {caps_ok}")
    print(f"\nrationale: {res['rationale']}")


if __name__ == "__main__":
    md = load_market_data()
    res = optimize(md)
    print_table(res)
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "result.json")
    with open(out, "w") as f:
        json.dump(res, f, indent=2)
    print(f"\n[optimize] wrote {out}")
    print(f"[optimize] numpy available: {_HAVE_NUMPY}")
