// AVV allocation optimizer (TypeScript).
//
// Pure, deterministic, no network. Same math as optimize.py (the reference). See
// EQUATION.md for the full derivation. Summary: each Morpho-style supply market
// has a diminishing yield curve r_i(d_i) driven by utilization
// u_i(d_i) = B_i / (S_i + d_i) through an AdaptiveCurveIrm-style piecewise-linear
// borrow rate; we maximize J(w) = sum_i w_i r_i(w_i C) - (lambda/2) w^T Sigma w
// subject to budget, per-venue cap, total-out cap, reserve floor, and liquidity
// caps, by projected gradient warm start plus an exact concave coordinate-ascent
// refinement (kink- and boundary-safe dense 1-D scans).
//
// No emojis, no em dashes (house style).

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

/** One asset as delivered by research/market-data.json (research schema) OR the
 *  built-in SAMPLE. Every field is optional so the optimizer can degrade. */
export interface RawAsset {
  symbol: string;
  venueId?: number;
  decimals?: number;
  priceUsd?: number;
  // market state (any of these; the rest is derived)
  totalBorrowAssets?: number;
  totalSupplyAssets?: number;
  utilization?: number;
  tvlUsd?: number;
  availableLiquidityUsd?: number;
  availableLiquidity?: number;
  supplyApy?: number;
  supplyApyOnchainComputed?: number;
  performanceFee?: number;
  fee?: number;
  annualizedVol?: number;
}

export interface MarketData {
  asOf?: string;
  chainId?: number;
  dataSource?: string;
  // research: array of RawAsset; SAMPLE: object keyed by symbol
  assets: RawAsset[] | Record<string, Omit<RawAsset, "symbol">>;
  // research: pairwiseCorrelation.{order,matrix}; SAMPLE: correlation matrix
  pairwiseCorrelation?: { order?: string[]; matrix: number[][] };
  correlation?: number[][];
  irm?: { targetUtilization?: number; curveSteepness?: number };
}

export interface OptimizeParams {
  capital: number; // USD notional C
  cap: number; // per-venue weight cap
  maxTotalOut: number; // cap on sum of deployed weights
  reserveFloor: number; // minimum reserve weight
  lambda: number; // risk aversion
  reserveApy: number; // yield on the reserve sink
  uTarget: number; // IRM kink utilization u*
  curveSteepness: number; // IRM steepness s
  rateAtTarget: number; // fallback rateAtTarget if calibration not possible
  defaultFee: number; // fee if none supplied AND no net APY given
  depegVol: number; // vol floor for stablecoin depeg tail
  iterations: number; // projected-gradient warm-start iterations
  step0: number; // initial gradient step
  scanSamples: number; // dense 1-D scan resolution in refinement
}

export const DEFAULT_PARAMS: OptimizeParams = {
  capital: 1_000_000,
  cap: 0.3,
  maxTotalOut: 0.8,
  reserveFloor: 0.2,
  lambda: 0.1,
  reserveApy: 0.0,
  uTarget: 0.9,
  curveSteepness: 4.0,
  rateAtTarget: 0.05,
  defaultFee: 0.0,
  depegVol: 0.02,
  iterations: 3000,
  step0: 1.0,
  scanSamples: 200,
};

export interface PerVenue {
  symbol: string;
  venueId: number;
  weight: number;
  amountUsd: number;
  tokenAmount: number;
  decimals: number;
  supplyApyPostDeposit: number;
  marginalYield: number;
  bindingConstraint: string;
}

export interface OptimizeResult {
  asOf: string;
  chainId: number;
  dataSource: string;
  capital: number;
  params: {
    cap: number;
    maxTotalOut: number;
    reserveFloor: number;
    lambda: number;
    reserveApy: number;
    uTarget: number;
    curveSteepness: number;
  };
  weights: Record<string, number>;
  reserve: number;
  expectedApy: number;
  expectedRiskAdjApy: number;
  perVenue: PerVenue[];
  waterLine: number | null;
  assumptions: string[];
  rationale: string;
}

// Internal normalized venue.
interface Venue {
  symbol: string;
  venueId: number;
  decimals: number;
  priceUsd: number;
  B: number; // USD borrow
  S: number; // USD supply
  fee: number; // fee applied inside the model
  capp: number; // per-venue cap tightened by liquidity
  liqUsd: number | null;
  capIsLiquidity: boolean;
  vol: number;
  rateAtTarget: number;
  observedApy: number | null;
}

// --------------------------------------------------------------------------- //
// Yield-curve model
// --------------------------------------------------------------------------- //

/** AdaptiveCurveIrm piecewise-linear borrow rate (eq. 2 in EQUATION.md). */
function borrowRate(u: number, rateAtTarget: number, p: OptimizeParams): number {
  u = Math.max(0, Math.min(1, u));
  const ut = p.uTarget;
  const s = p.curveSteepness;
  if (u <= ut) {
    const frac = ut > 0 ? u / ut : 0;
    return rateAtTarget * (frac * (1 - 1 / s) + 1 / s);
  }
  const frac = ut < 1 ? (u - ut) / (1 - ut) : 0;
  return rateAtTarget * (1 + (s - 1) * frac);
}

/** Post-deposit supply APY r_i(d_i) (eq. 3). Decreasing in depositUsd. */
function supplyRate(depositUsd: number, v: Venue, p: OptimizeParams): number {
  const denom = v.S + Math.max(0, depositUsd);
  const u = denom > 0 ? v.B / denom : 0;
  return borrowRate(u, v.rateAtTarget, p) * u * (1 - v.fee);
}

/** Solve rateAtTarget so supply APY at current util u0 equals observedSupplyApy. */
function calibrateRateAtTarget(
  u0: number,
  observedSupplyApy: number,
  fee: number,
  p: OptimizeParams,
): number {
  const unit = borrowRate(u0, 1.0, p) * u0 * (1 - fee); // APY at rateAtTarget=1
  if (unit <= 0) return p.rateAtTarget;
  return observedSupplyApy / unit;
}

/** w_i * r_i(w_i C): venue i's contribution to portfolio APY (fraction of C). */
function yieldContribution(
  wI: number,
  v: Venue,
  C: number,
  p: OptimizeParams,
): number {
  const d = wI * C;
  return wI * supplyRate(d, v, p);
}

/** m_i(w_i) = d/dw_i [ w_i r_i(w_i C) ] via central finite difference (eq. 7). */
function marginalYield(
  wI: number,
  v: Venue,
  C: number,
  p: OptimizeParams,
): number {
  const h = 1e-6;
  const hi = yieldContribution(wI + h, v, C, p);
  const lo = yieldContribution(Math.max(0, wI - h), v, C, p);
  return (hi - lo) / (2 * h);
}

// --------------------------------------------------------------------------- //
// Linear algebra (tiny, no deps)
// --------------------------------------------------------------------------- //
function covTimes(Sigma: number[][], w: number[]): number[] {
  const n = w.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Sigma[i][j] * w[j];
    out[i] = s;
  }
  return out;
}

function quadForm(Sigma: number[][], w: number[]): number {
  const Sw = covTimes(Sigma, w);
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * Sw[i];
  return s;
}

function objective(
  w: number[],
  venues: Venue[],
  Sigma: number[][],
  C: number,
  p: OptimizeParams,
): number {
  let R = 0;
  for (let i = 0; i < w.length; i++) R += yieldContribution(w[i], venues[i], C, p);
  return R - 0.5 * p.lambda * quadForm(Sigma, w);
}

// --------------------------------------------------------------------------- //
// Projection onto F = { 0 <= w_i <= capp_i, sum w_i <= T } (water-filling)
// --------------------------------------------------------------------------- //
function project(w: number[], capp: number[], T: number): number[] {
  const n = w.length;
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.min(capp[i], Math.max(0, w[i]));
  let sum = x.reduce((a, b) => a + b, 0);
  if (sum <= T + 1e-15) return x;
  let lo = 0;
  let hi = Math.max(...x);
  for (let it = 0; it < 200; it++) {
    const tau = 0.5 * (lo + hi);
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.min(capp[i], Math.max(0, x[i] - tau));
    if (s > T) lo = tau;
    else hi = tau;
  }
  const tau = hi;
  return x.map((xi, i) => Math.min(capp[i], Math.max(0, xi - tau)));
}

// --------------------------------------------------------------------------- //
// Refinement: robust dense 1-D scan + concave coordinate/pairwise ascent
// --------------------------------------------------------------------------- //
function scanMax1d(
  f: (x: number) => number,
  lo: number,
  hi: number,
  samples: number,
): number {
  if (hi - lo < 1e-15) return lo;
  let bestX = lo;
  let bestF = f(lo);
  for (let k = 1; k <= samples; k++) {
    const x = lo + ((hi - lo) * k) / samples;
    const fx = f(x);
    if (fx > bestF) {
      bestF = fx;
      bestX = x;
    }
  }
  const h = (hi - lo) / samples;
  const a2 = Math.max(lo, bestX - h);
  const b2 = Math.min(hi, bestX + h);
  for (let k = 0; k <= samples; k++) {
    const x = a2 + ((b2 - a2) * k) / samples;
    const fx = f(x);
    if (fx > bestF) {
      bestF = fx;
      bestX = x;
    }
  }
  return bestX;
}

function refine(
  wIn: number[],
  venues: Venue[],
  capp: number[],
  Sigma: number[][],
  C: number,
  T: number,
  p: OptimizeParams,
): number[] {
  const n = wIn.length;
  const w = [...wIn];
  const clamp = (x: number, i: number) => Math.min(capp[i], Math.max(0, x));

  for (let iter = 0; iter < 200; iter++) {
    const base = objective(w, venues, Sigma, C, p);
    let slack = T - w.reduce((a, b) => a + b, 0);

    // (1) single-coordinate moves.
    for (let i = 0; i < n; i++) {
      const lo = 0;
      const hi = Math.min(capp[i], w[i] + Math.max(0, slack));
      const f1 = (x: number): number => {
        w[i] = clamp(x, i);
        return objective(w, venues, Sigma, C, p);
      };
      const xstar = scanMax1d(f1, lo, hi, p.scanSamples);
      w[i] = clamp(xstar, i);
      slack = T - w.reduce((a, b) => a + b, 0);
    }

    // (2) pairwise budget-neutral transfers.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const wi0 = w[i];
        const wj0 = w[j];
        const tMax = Math.min(capp[i] - wi0, wj0);
        const tMin = -Math.min(capp[j] - wj0, wi0);
        if (tMax - tMin < 1e-15) continue;
        const ft = (t: number): number => {
          w[i] = clamp(wi0 + t, i);
          w[j] = clamp(wj0 - t, j);
          return objective(w, venues, Sigma, C, p);
        };
        const tstar = scanMax1d(ft, tMin, tMax, p.scanSamples);
        ft(tstar);
      }
    }

    if (objective(w, venues, Sigma, C, p) - base <= 1e-12) break;
  }
  return w;
}

// --------------------------------------------------------------------------- //
// Normalize either schema into canonical venues + covariance
// --------------------------------------------------------------------------- //
function normalizeMarketData(
  md: MarketData,
  pIn: OptimizeParams,
  C: number,
): { venues: Venue[]; Sigma: number[][]; symbols: string[]; assumptions: string[]; p: OptimizeParams } {
  const assumptions: string[] = [];
  let p = { ...pIn };

  // unpack assets (list or symbol-keyed object)
  let assets: RawAsset[];
  if (Array.isArray(md.assets)) {
    assets = md.assets.slice();
  } else {
    assets = Object.entries(md.assets).map(([symbol, v]) => ({ symbol, ...v }));
    assets.sort((a, b) => (a.venueId ?? 0) - (b.venueId ?? 0));
  }
  const n = assets.length;
  const symbols = assets.map((a) => a.symbol);

  // IRM shape from research if present
  if (md.irm) {
    if (md.irm.targetUtilization != null) p = { ...p, uTarget: md.irm.targetUtilization };
    if (md.irm.curveSteepness != null) p = { ...p, curveSteepness: md.irm.curveSteepness };
  }

  const venues: Venue[] = assets.map((a, idx) => {
    let util = a.utilization;
    const liqUsd = a.availableLiquidityUsd ?? a.availableLiquidity ?? null;

    let B = a.totalBorrowAssets;
    let S = a.totalSupplyAssets;
    if (B == null || S == null) {
      if (util != null && a.tvlUsd != null) {
        S = a.tvlUsd;
        B = util * S;
        assumptions.push(`${a.symbol}: B,S(USD) derived from utilization*tvlUsd`);
      } else if (util != null && liqUsd != null) {
        const u = util;
        S = liqUsd / Math.max(1e-9, 1 - u);
        B = u * S;
        assumptions.push(
          `${a.symbol}: B,S(USD) derived from utilization+availableLiquidity`,
        );
      } else {
        S = liqUsd ?? 1;
        B = 0;
        assumptions.push(`${a.symbol}: missing borrow/supply, assumed idle market`);
      }
    }
    if (util == null) util = S! > 0 ? B! / S! : 0;

    const fee = a.fee ?? a.performanceFee ?? p.defaultFee;
    // research supplyApy is already NET of the performance fee, so calibrate the
    // model with fee=0 when a net APY is available.
    const observedApy = a.supplyApy ?? a.supplyApyOnchainComputed ?? null;
    const modelFee = observedApy != null ? 0 : fee;

    let rateAtTarget: number;
    if (observedApy != null) {
      rateAtTarget = calibrateRateAtTarget(util, observedApy, modelFee, p);
    } else {
      rateAtTarget = p.rateAtTarget;
      assumptions.push(`${a.symbol}: no observed supplyApy, used default rateAtTarget`);
    }

    let vol = a.annualizedVol;
    if (vol == null) {
      vol = 0;
      assumptions.push(`${a.symbol}: missing annualizedVol, assumed 0`);
    }
    if (vol < p.depegVol) vol = p.depegVol; // depeg tail floor

    let cap = p.cap;
    let capIsLiquidity = false;
    if (liqUsd != null && C > 0) {
      const liqCap = liqUsd / C;
      if (liqCap < cap) {
        cap = liqCap;
        capIsLiquidity = true;
      }
    }

    return {
      symbol: a.symbol,
      venueId: a.venueId ?? idx,
      decimals: a.decimals ?? 18,
      priceUsd: a.priceUsd ?? 0,
      B: B!,
      S: S!,
      fee: modelFee,
      capp: cap,
      liqUsd,
      capIsLiquidity,
      vol,
      rateAtTarget,
      observedApy,
    };
  });

  // correlation
  let corr: number[][] | null = null;
  const pc = md.pairwiseCorrelation;
  if (pc && pc.matrix) {
    if (pc.order && pc.order.length === n) {
      const pos: Record<string, number> = {};
      pc.order.forEach((s, i) => (pos[s] = i));
      corr = symbols.map((si) => symbols.map((sj) => pc.matrix[pos[si]][pos[sj]]));
    } else {
      corr = pc.matrix;
    }
  } else if (md.correlation) {
    corr = md.correlation;
  }
  if (!corr || corr.length !== n) {
    corr = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    );
    assumptions.push("missing/mismatched correlation matrix, assumed identity");
  }

  const vols = venues.map((v) => v.vol);
  const Sigma = corr.map((row, i) => row.map((c, j) => c * vols[i] * vols[j]));

  return { venues, Sigma, symbols, assumptions, p };
}

// --------------------------------------------------------------------------- //
// Public API
// --------------------------------------------------------------------------- //
export function optimize(
  marketData: MarketData,
  params?: Partial<OptimizeParams>,
): OptimizeResult {
  const p: OptimizeParams = { ...DEFAULT_PARAMS, ...(params ?? {}) };
  const C = p.capital;

  const norm = normalizeMarketData(marketData, p, C);
  const { venues, Sigma, symbols, assumptions } = norm;
  const pEff = norm.p;
  const n = venues.length;
  const capp = venues.map((v) => v.capp);

  const T = Math.min(pEff.maxTotalOut, 1 - pEff.reserveFloor);

  // Projected gradient ascent warm start.
  let w = new Array(n).fill(0);
  for (let k = 0; k < pEff.iterations; k++) {
    const step = pEff.step0 / (1 + 0.0005 * k);
    const Sw = covTimes(Sigma, w);
    const cand = w.map(
      (wi, i) => wi + step * (marginalYield(wi, venues[i], C, pEff) - pEff.lambda * Sw[i]),
    );
    w = project(cand, capp, T);
  }

  // Exact concave refinement (kink/boundary-safe).
  w = refine(w, venues, capp, Sigma, C, T, pEff);

  let reserve = 1 - w.reduce((a, b) => a + b, 0);
  if (reserve < pEff.reserveFloor - 1e-9) reserve = pEff.reserveFloor;

  const expectedApy =
    venues.reduce((s, v, i) => s + yieldContribution(w[i], v, C, pEff), 0) +
    reserve * pEff.reserveApy;
  const riskPen = 0.5 * pEff.lambda * quadForm(Sigma, w);
  const riskAdjApy = expectedApy - riskPen;

  const tol = 5e-4;
  const Sw = covTimes(Sigma, w);
  let nu: number | null = null;
  for (let i = 0; i < n; i++) {
    const g = marginalYield(w[i], venues[i], C, pEff) - pEff.lambda * Sw[i];
    if (w[i] > tol && w[i] < capp[i] - tol) nu = nu == null ? g : Math.max(nu, g);
  }

  const perVenue: PerVenue[] = venues.map((v, i) => {
    const dUsd = w[i] * C;
    const g = marginalYield(w[i], v, C, pEff) - pEff.lambda * Sw[i];
    let binding: string;
    if (w[i] <= tol) binding = "excluded (below water line)";
    else if (w[i] >= capp[i] - tol) binding = v.capIsLiquidity ? "liquidity" : "venue cap";
    else binding = "interior (on water line)";
    const tokenAmount = v.priceUsd > 0 ? dUsd / v.priceUsd : 0;
    return {
      symbol: v.symbol,
      venueId: v.venueId,
      weight: round(w[i], 8),
      amountUsd: round(dUsd, 2),
      tokenAmount: round(tokenAmount, 6),
      decimals: v.decimals,
      supplyApyPostDeposit: round(supplyRate(dUsd, v, pEff), 6),
      marginalYield: round(g, 8),
      bindingConstraint: binding,
    };
  });

  const rationale = buildRationale(perVenue, reserve, pEff, T, assumptions);

  const weights: Record<string, number> = {};
  symbols.forEach((s, i) => (weights[s] = round(w[i], 8)));

  return {
    asOf: marketData.asOf ?? "SAMPLE",
    chainId: marketData.chainId ?? 14,
    dataSource: marketData.dataSource ?? "SAMPLE",
    capital: C,
    params: {
      cap: pEff.cap,
      maxTotalOut: pEff.maxTotalOut,
      reserveFloor: pEff.reserveFloor,
      lambda: pEff.lambda,
      reserveApy: pEff.reserveApy,
      uTarget: pEff.uTarget,
      curveSteepness: pEff.curveSteepness,
    },
    weights,
    reserve: round(reserve, 8),
    expectedApy: round(expectedApy, 6),
    expectedRiskAdjApy: round(riskAdjApy, 6),
    perVenue,
    waterLine: nu == null ? null : round(nu, 8),
    assumptions,
    rationale,
  };
}

function buildRationale(
  perVenue: PerVenue[],
  reserve: number,
  p: OptimizeParams,
  T: number,
  assumptions: string[],
): string {
  const clamped = perVenue
    .filter((v) => v.bindingConstraint === "venue cap" || v.bindingConstraint === "liquidity")
    .map((v) => v.symbol);
  const interior = perVenue
    .filter((v) => v.bindingConstraint.startsWith("interior"))
    .map((v) => v.symbol);
  const excluded = perVenue
    .filter((v) => v.bindingConstraint.startsWith("excluded"))
    .map((v) => v.symbol);
  const parts: string[] = [];
  parts.push(
    `Maximized risk-adjusted yield (lambda=${p.lambda}) by water-filling: funded venues equalize risk-adjusted marginal yield up to their caps.`,
  );
  if (clamped.length) parts.push(`Clamped at cap/liquidity: ${clamped.join(", ")}.`);
  if (interior.length) parts.push(`Interior (sit on the water line): ${interior.join(", ")}.`);
  if (excluded.length) parts.push(`Excluded (below water line): ${excluded.join(", ")}.`);
  parts.push(
    `Reserve = ${(reserve * 100).toFixed(2)}% (floor ${(p.reserveFloor * 100).toFixed(0)}%); total deployed budget T = ${(T * 100).toFixed(0)}%.`,
  );
  if (assumptions.length) parts.push("Assumptions: " + assumptions.join("; ") + ".");
  return parts.join(" ");
}

function round(x: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

// --------------------------------------------------------------------------- //
// Built-in labeled SAMPLE (mirrors optimize.py; used only by the demo runner).
// --------------------------------------------------------------------------- //
export const SAMPLE_MARKET_DATA: MarketData = {
  asOf: "SAMPLE",
  dataSource: "SAMPLE",
  chainId: 14,
  assets: {
    FXRP: {
      venueId: 0,
      decimals: 6,
      priceUsd: 0.5,
      totalBorrowAssets: 3_200_000,
      totalSupplyAssets: 4_000_000,
      utilization: 0.8,
      availableLiquidity: 800_000,
      annualizedVol: 0.55,
      performanceFee: 0.1,
    },
    USDT0: {
      venueId: 1,
      decimals: 6,
      priceUsd: 1.0,
      totalBorrowAssets: 7_200_000,
      totalSupplyAssets: 8_000_000,
      utilization: 0.9,
      availableLiquidity: 800_000,
      annualizedVol: 0.0,
      performanceFee: 0.1,
    },
    WFLR: {
      venueId: 2,
      decimals: 18,
      priceUsd: 0.02,
      totalBorrowAssets: 1_800_000,
      totalSupplyAssets: 3_000_000,
      utilization: 0.6,
      availableLiquidity: 1_200_000,
      annualizedVol: 0.7,
      performanceFee: 0.1,
    },
  },
  correlation: [
    [1.0, 0.1, 0.45],
    [0.1, 1.0, 0.05],
    [0.45, 0.05, 1.0],
  ],
};
