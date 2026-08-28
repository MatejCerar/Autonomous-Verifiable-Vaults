// Automated Verifiable Vault dashboard.
//
// The whole app is the real Flare TEE cycle: read the on-chain best position
// from AllocationDisplay, let the operator run a rebalance (sendCuration ->
// enclave -> pushCycle), and show the recorded cycles. No walkthrough, no
// client-side-only mode.
//
// No emojis, no em dashes (house style).
import { useCallback, useEffect, useState } from "react";
import { Box, Container, Grid, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { Hex } from "viem";
import { runCycle, readLivePrices, type CycleResult } from "@/live";
import {
  makeCoston2Client,
  readDisplay,
  runInRealTee,
  runViaGateway,
  proxyHealthy,
  type OnChainCycle,
  type RunTeeResult,
  type TeeStep,
} from "@/tee";
import type { MarketData } from "@/data";
import {
  displayConfigured,
  teeConfigured,
  gatewayConfigured,
  GATEWAY_URL,
  CURATION_CONTROLLER,
  CURATION_CONTROLLER_ABI,
} from "@/tee.config";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { NotConnected } from "@/components/NotConnected";
import { PositionCard } from "@/components/PositionCard";
import { RunPanel } from "@/components/RunPanel";
import { LiveInputs } from "@/components/LiveInputs";
import { ActivityFeed } from "@/components/ActivityFeed";
import { readRecentCycles, type CycleEvent } from "@/components/cycles";
import fallbackSnapshot from "@/fallbackSnapshot.json";

// Default capital + placeholder receiver for the live Mystic read feeding the
// enclave snapshot. These are model inputs, not on-chain writes.
const CAPITAL = 1_000_000;
const RECEIVER = "0x0000000000000000000000000000000000000001" as Hex;

// Reject a promise if it does not settle within ms, so a slow/blocked network
// call can never hang the button.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// Always produce a non-empty, human-readable message from any thrown value, so
// the error alert is never blank.
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || "Unknown error";
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// Human labels per TeeStep, for the loading overlay subtitle.
const STEP_LABEL: Record<string, string> = {
  "submitting-instruction": "Submitting the instruction on-chain",
  "waiting-for-enclave": "Waiting for the enclave to compute + sign",
  "writing-on-chain": "Writing the plan to the vault",
  "reading-on-chain": "Reading the recorded cycle back",
  done: "Done",
};

// Loading overlay driven by direct DOM (not React state), so it always shows the
// instant the button is clicked regardless of React re-render timing.
function showLoadingOverlay(title: string) {
  if (document.getElementById("avv-loading")) return;
  const el = document.createElement("div");
  el.id = "avv-loading";
  el.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;" +
    "align-items:center;justify-content:center;gap:16px;color:#fff;" +
    "background:rgba(8,8,14,0.78);backdrop-filter:blur(3px);" +
    "font-family:Inter,ui-sans-serif,system-ui,sans-serif;";
  el.innerHTML =
    '<div style="width:52px;height:52px;border:4px solid rgba(255,255,255,0.2);' +
    'border-top-color:#ff1364;border-radius:50%;animation:avvspin .9s linear infinite;"></div>' +
    '<div id="avv-loading-title" style="font-weight:700;font-size:19px;"></div>' +
    '<div id="avv-loading-sub" style="opacity:.7;font-size:13px;">Starting... 0s</div>' +
    "<style>@keyframes avvspin{to{transform:rotate(360deg)}}</style>";
  document.body.appendChild(el);
  const t = document.getElementById("avv-loading-title");
  if (t) t.textContent = title;
}
function setLoadingSub(sub: string) {
  const el = document.getElementById("avv-loading-sub");
  if (el) el.textContent = sub;
}
function hideLoadingOverlay() {
  document.getElementById("avv-loading")?.remove();
}

// Persist cycleId -> on-chain tx hash so the Activity feed can link to the tx
// even after a reload / when seeded from chain (public Coston2 RPCs give no log
// history to recover the tx hash otherwise).
const TX_STORE_KEY = "avv:cycleTx";
function saveCycleTx(cycleId: bigint, txHash: string) {
  try {
    const raw = localStorage.getItem(TX_STORE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[cycleId.toString()] = txHash;
    localStorage.setItem(TX_STORE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable; the in-session row still carries the hash.
  }
}
function loadCycleTx(cycleId: bigint): Hex | undefined {
  try {
    const raw = localStorage.getItem(TX_STORE_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw)[cycleId.toString()];
    return typeof v === "string" ? (v as Hex) : undefined;
  } catch {
    return undefined;
  }
}

// Persist the last executed cycle (from CurationController.executePlan or the
// client-side local plan). CurationController does not store a display cycle to
// read back, so we keep the executed allocation here to survive the post-run
// page reload and seed the position + activity feed.
const CYCLE_STORE_KEY = "avv:lastCycle";
function saveLastCycle(cycle: OnChainCycle, txHash: Hex, mode: "tee" | "local") {
  try {
    localStorage.setItem(
      CYCLE_STORE_KEY,
      JSON.stringify({
        planId: cycle.planId,
        totalOut: cycle.totalOut.toString(),
        reserveAmount: cycle.reserveAmount.toString(),
        amounts: cycle.amounts.map((a) => a.toString()),
        timestamp: cycle.timestamp.toString(),
        cycleId: cycle.cycleId.toString(),
        txHash,
        mode,
      }),
    );
  } catch {
    // localStorage unavailable; the in-session state still carries the cycle.
  }
}
function loadLastCycle():
  | { cycle: OnChainCycle; txHash: Hex; mode: "tee" | "local" }
  | undefined {
  try {
    const raw = localStorage.getItem(CYCLE_STORE_KEY);
    if (!raw) return undefined;
    const o = JSON.parse(raw);
    return {
      cycle: {
        planId: o.planId as Hex,
        totalOut: BigInt(o.totalOut),
        reserveAmount: BigInt(o.reserveAmount),
        amounts: (o.amounts as string[]).map((a) => BigInt(a)) as unknown as [
          bigint,
          bigint,
          bigint,
        ],
        timestamp: BigInt(o.timestamp),
        cycleId: BigInt(o.cycleId),
      },
      txHash: (o.txHash as Hex) ?? ("0x" as Hex),
      mode: (o.mode as "tee" | "local") ?? "tee",
    };
  } catch {
    return undefined;
  }
}

export function App() {
  const teeReady = teeConfigured() || gatewayConfigured();
  const displayReady = displayConfigured();

  // A ticking "now" so relative timestamps stay fresh.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // On-chain position (AllocationDisplay.latest() + cycleCount()).
  const [position, setPosition] = useState<OnChainCycle>();
  const [cycleCount, setCycleCount] = useState<bigint>();
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState<string>();

  // Activity feed (CyclePushed events).
  const [feed, setFeed] = useState<CycleEvent[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  // The last live Mystic snapshot that fed a cycle (drives Live Inputs).
  const [cycle, setCycle] = useState<CycleResult>();

  // Live FTSO prices for the Live Inputs card, refreshed on the poll loop. This
  // is a fast, robust read (2 on-chain calls, no DefiLlama) so the card shows
  // fresh prices even when the full runCycle is slow.
  const [liveMarket, setLiveMarket] = useState<MarketData>();

  const refreshMarket = useCallback(async () => {
    try {
      // Prefer the enclave's live Mystic market (it reads Flare mainnet +
      // DefiLlama from the server): this gives live venue APY/util, not just
      // prices. Fall back to a Coston2 FTSO price-only read.
      if (gatewayConfigured()) {
        try {
          const res = await fetch(`${GATEWAY_URL.replace(/\/+$/, "")}/market`);
          const body = (await res.json()) as { market?: MarketData };
          if (body?.market?.assets) {
            console.log("[AVV] live Mystic market from enclave");
            setLiveMarket(body.market);
            return;
          }
        } catch {
          // fall through to the price-only read
        }
      }
      const p = await readLivePrices();
      console.log("[AVV] live FTSO (Coston2):", p.flrUsd, p.xrpUsd, p.at);
      const base = fallbackSnapshot as unknown as MarketData;
      setLiveMarket({
        ...base,
        asOf: p.at,
        prices: {
          FLR_USD: { value: p.flrUsd, source: `FTSO V2 live (${p.ftsoSource})`, confidence: "high" },
          XRP_USD: { value: p.xrpUsd, source: `FTSO V2 live (${p.ftsoSource})`, confidence: "high" },
          USDT0_USD: { value: 1.0, source: "assumed peg", confidence: "assumed-peg" },
        },
      });
    } catch (e) {
      console.warn("[AVV] live price read failed:", e);
    }
  }, []);

  // Read live FTSO prices immediately on open (ungated), so the Live Inputs card
  // shows fresh Coston2 prices without waiting on anything else.
  useEffect(() => {
    void refreshMarket();
  }, [refreshMarket]);

  // The TEE run for this session (for the instruction tx link in the feed).
  const [lastRun, setLastRun] = useState<RunTeeResult>();
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<TeeStep>();
  const [runError, setRunError] = useState<string>();

  const refreshPosition = useCallback(async () => {
    setPositionLoading(true);
    setPositionError(undefined);
    try {
      const pub = makeCoston2Client();
      // The position is the last plan CurationController enforced. The controller
      // holds no readable "latest cycle", so we persist each executed cycle and
      // show it; the live nonce is the on-chain cycle count. (No AllocationDisplay.)
      const cc = (await pub.readContract({
        address: CURATION_CONTROLLER,
        abi: CURATION_CONTROLLER_ABI,
        functionName: "nonce",
      })) as bigint;
      const last = loadLastCycle();
      if (last) setPosition(last.cycle);
      setCycleCount(cc);
    } catch (e) {
      setPositionError((e as Error).message ?? String(e));
    } finally {
      setPositionLoading(false);
    }
  }, []);

  const refreshFeed = useCallback(async () => {
    if (!displayReady) return;
    setFeedLoading(true);
    try {
      const pub = makeCoston2Client();
      const logs = await readRecentCycles(pub, 10);
      if (logs.length > 0) {
        setFeed(logs);
        return;
      }
      // Public Coston2 RPCs have no usable getLogs history, so seed the feed with
      // the last executed cycle we persisted (CurationController stores no cycle
      // to read back), falling back to the AllocationDisplay vault. This way a
      // recorded position is always shown, not just cycles run this session.
      const last = loadLastCycle();
      if (last && last.cycle.cycleId > 0n) {
        setFeed([
          {
            cycleId: last.cycle.cycleId,
            planId: last.cycle.planId,
            totalOut: last.cycle.totalOut,
            reserveAmount: last.cycle.reserveAmount,
            amounts: last.cycle.amounts,
            timestamp: last.cycle.timestamp,
            txHash:
              last.txHash !== "0x"
                ? last.txHash
                : loadCycleTx(last.cycle.cycleId) ?? ("0x" as Hex),
            blockNumber: 0n,
          },
        ]);
        return;
      }
      const { cycle } = await readDisplay(pub);
      if (cycle && cycle.cycleId > 0n) {
        setFeed([
          {
            cycleId: cycle.cycleId,
            planId: cycle.planId,
            totalOut: cycle.totalOut,
            reserveAmount: cycle.reserveAmount,
            amounts: cycle.amounts,
            timestamp: cycle.timestamp,
            txHash: loadCycleTx(cycle.cycleId) ?? ("0x" as Hex),
            blockNumber: 0n,
          },
        ]);
      }
    } finally {
      setFeedLoading(false);
    }
  }, [displayReady]);

  useEffect(() => {
    void refreshPosition();
    void refreshFeed();
  }, [refreshPosition, refreshFeed]);

  // Poll the vault from chain so the UI reflects new cycles on its own, without
  // any manual page refresh. This is the source of truth: whatever the button
  // writes on-chain shows up here within one interval. Live prices refresh on a
  // slower cadence.
  useEffect(() => {
    if (!displayReady) return;
    void refreshMarket();
    const id = setInterval(() => {
      void refreshPosition();
      void refreshFeed();
    }, 4_000);
    const mid = setInterval(() => void refreshMarket(), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(mid);
    };
  }, [displayReady, refreshPosition, refreshFeed, refreshMarket]);

  // Refetch live inputs on any click on the page (throttled), so the prices are
  // fresh whenever the user interacts.
  useEffect(() => {
    let last = 0;
    const onClick = () => {
      const t = Date.now();
      if (t - last < 3_000) return;
      last = t;
      void refreshMarket();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [refreshMarket]);

  // Load a live Mystic market snapshot on open so Live Inputs are visible before
  // the first run. Best-effort and time-bounded: never blocks the page.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await withTimeout(
          runCycle({ capital: CAPITAL, receiver: RECEIVER }),
          15_000,
          "live market read",
        );
        if (!cancelled) setCycle(fresh);
      } catch (e) {
        console.warn("[AVV] initial live market read failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onRun = useCallback(async () => {
    setRunning(true);
    setRunError(undefined);
    setStep("submitting-instruction");
    console.log("[AVV] Run rebalance cycle: start");

    // Show a loading overlay via direct DOM the instant the button is clicked,
    // and tick an elapsed timer + step label into it. This does not depend on
    // React re-rendering, so it always appears immediately.
    const started = Date.now();
    showLoadingOverlay(
      teeReady ? "Running your model in the Flare TEE..." : "Recording cycle on-chain...",
    );
    let curStep = "Starting";
    const timer = window.setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      setLoadingSub(`${curStep} - ${secs}s`);
    }, 250);
    const onStep = (s: TeeStep) => {
      setStep(s);
      curStep = STEP_LABEL[s] ?? s;
    };

    const toastId = "avv-run";
    notifications.show({
      id: toastId,
      loading: true,
      title: "Running rebalance cycle",
      message: "Reading the live market and computing the allocation...",
      autoClose: false,
      withCloseButton: false,
    });
    try {
      // 1. Read a fresh live Mystic snapshot to send to the enclave. Best-effort
      //    and time-bounded: if the live read fails, fall back to the bundled
      //    snapshot (the enclave still computes + signs the plan either way).
      let snapshot: unknown = fallbackSnapshot;
      try {
        const fresh = await withTimeout(
          runCycle({ capital: CAPITAL, receiver: RECEIVER }),
          15_000,
          "live market read",
        );
        setCycle(fresh);
        snapshot = fresh.market;
        console.log("[AVV] live market read OK");
      } catch (e) {
        console.warn("[AVV] live read failed, using bundled snapshot:", e);
      }

      // 2. REAL TEE path: the enclave gateway (preferred) forwards the snapshot
      //    to the live Flare enclave, which computes + signs the plan in the TEE;
      //    we then enforce it on-chain via CurationController.executePlan. Falls
      //    back to the on-chain FCC transport if a gateway is not set.
      let result: RunTeeResult;
      if (gatewayConfigured()) {
        console.log("[AVV] path: enclave gateway (real TEE)");
        result = await runViaGateway(snapshot, { onStep });
      } else if (teeReady && (await proxyHealthy())) {
        console.log("[AVV] path: FCC on-chain transport (real TEE)");
        result = await runInRealTee(snapshot, { onStep });
      } else {
        throw new Error(
          "No live TEE configured. Set GATEWAY_URL (or INSTRUCTION_SENDER + EXT_PROXY_URL) in src/tee.config.ts.",
        );
      }
      console.log("[AVV] cycle recorded:", result.mode, "tx", result.txHash);
      setLastRun(result);

      const recordedCycle = result.display?.cycle.cycleId;
      const enforced = result.mode === "tee" && result.txHash !== "0x";
      notifications.update({
        id: toastId,
        loading: false,
        color: "teal",
        title: enforced
          ? recordedCycle
            ? `Cycle #${recordedCycle.toString()} enforced on-chain`
            : "Cycle enforced on-chain"
          : "Plan computed (client-side)",
        message: enforced
          ? `Enforced by CurationController on Coston2. Tx ${result.txHash.slice(0, 10)}...`
          : "Computed client-side (TEE proxy offline); not enforced on-chain.",
        autoClose: 6000,
        withCloseButton: true,
      });

      // Refresh the on-chain view from the read-back the run already did, and
      // prepend this cycle to the activity feed (getLogs history is unavailable
      // on public Coston2 RPCs).
      if (result.display) {
        const c = result.display.cycle;
        // executePlan is the tx that enforced this cycle on-chain (for local mode
        // there is none: "0x"). Persist the executed cycle + its tx so the
        // position, activity link, and feed survive the post-run reload/polling.
        const cycleTx = result.display.pushTxHash ?? result.txHash;
        saveCycleTx(c.cycleId, cycleTx);
        saveLastCycle(c, cycleTx, result.mode);
        setPosition(c);
        setCycleCount(result.display.cycleCount);
        const row: CycleEvent = {
          cycleId: c.cycleId,
          planId: c.planId,
          totalOut: c.totalOut,
          reserveAmount: c.reserveAmount,
          amounts: c.amounts,
          timestamp: c.timestamp,
          txHash: cycleTx,
          blockNumber: 0n,
        };
        setFeed((prev) =>
          [row, ...prev.filter((r) => r.cycleId !== c.cycleId)].slice(0, 10),
        );
      } else {
        await refreshPosition();
      }

      // The cycle is on-chain. Reload so the whole page re-reads fresh state
      // (numbers, activity + tx link, and live inputs) exactly like a manual
      // refresh. The overlay stays up until the reload replaces the page.
      window.clearInterval(timer);
      setLoadingSub("Done - refreshing the page...");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      console.error("[AVV] Run rebalance cycle FAILED:", e);
      window.clearInterval(timer);
      hideLoadingOverlay();
      setRunError(errorText(e));
      notifications.update({
        id: toastId,
        loading: false,
        color: "red",
        title: "Cycle failed",
        message: errorText(e),
        autoClose: 8000,
        withCloseButton: true,
      });
    } finally {
      window.clearInterval(timer);
      setRunning(false);
    }
  }, [refreshPosition, refreshFeed, teeReady]);

  // The dashboard needs the on-chain display vault to read + write cycles. The
  // real TEE endpoint is optional: when it is offline the button computes the
  // plan client-side and still records it on-chain.
  if (!displayReady) {
    return (
      <Container size="lg" py="xl">
        <NotConnected />
      </Container>
    );
  }

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Header teeReady={teeReady} displayReady={displayReady} />

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="lg">
              <PositionCard
                cycle={position}
                cycleCount={cycleCount}
                loading={positionLoading}
                error={positionError}
                now={now}
              />
              <ActivityFeed
                cycles={feed}
                loading={feedLoading}
                now={now}
                sessionInstructionTx={
                  lastRun?.txHash && lastRun.txHash !== "0x"
                    ? lastRun.txHash
                    : undefined
                }
                sessionCycleId={lastRun?.display?.cycle.cycleId}
              />
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="lg">
              <RunPanel
                configured={displayReady}
                teeReady={teeReady}
                running={running}
                step={step}
                error={runError}
                lastMode={lastRun?.mode}
                lastTxHash={lastRun?.txHash}
                lastCycleId={lastRun?.display?.cycle.cycleId}
                onRun={() => void onRun()}
              />
              <LiveInputs
                market={
                  liveMarket ??
                  cycle?.market ??
                  (fallbackSnapshot as unknown as MarketData)
                }
                asOf={
                  liveMarket?.asOf ??
                  cycle?.at ??
                  (fallbackSnapshot as { asOf?: string }).asOf
                }
              />
            </Stack>
          </Grid.Col>
        </Grid>

        <Box>
          <Footer />
        </Box>
      </Stack>
    </Container>
  );
}
