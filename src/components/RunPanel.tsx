// PRIMARY ACTION: "Run rebalance cycle" button + an inline live-status stepper
// driven by the runInRealTee onStep callback. Each phase shows a spinner then a
// check. Disabled with an explanation when the TEE is not configured.
// No emojis, no em dashes (house style).
import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import type { Hex } from "viem";
import type { TeeStep } from "@/tee";
import { explorerTx } from "@/tee.config";

// The user-facing phases, mapped from the finer-grained TeeStep values.
type Phase = "reading" | "computing" | "writing" | "done";

const PHASES: { key: Phase; label: string }[] = [
  { key: "reading", label: "Reading the live market" },
  { key: "computing", label: "Enclave computes + signs the plan (in the TEE)" },
  { key: "writing", label: "Verify + enforce on-chain (executePlan)" },
  { key: "done", label: "Done" },
];

// Map the tee.ts step to the coarse UI phase index.
function phaseIndex(step?: TeeStep): number {
  switch (step) {
    case "submitting-instruction":
      return 0;
    case "waiting-for-enclave":
      return 1;
    case "writing-on-chain":
    case "reading-on-chain":
      return 2;
    case "done":
      return 3;
    default:
      return -1;
  }
}

const STEP_TEXT: Record<string, string> = {
  "submitting-instruction": "Reading the live market...",
  "waiting-for-enclave": "Enclave computing + signing the plan in the TEE...",
  "writing-on-chain": "Verifying + enforcing on-chain (executePlan)...",
  "reading-on-chain": "Reading the result back...",
  done: "Done.",
};

export function RunPanel({
  configured,
  teeReady,
  running,
  step,
  error,
  lastMode,
  lastTxHash,
  lastCycleId,
  onRun,
}: {
  configured: boolean;
  teeReady?: boolean;
  running: boolean;
  step?: TeeStep;
  error?: string;
  lastMode?: "tee" | "local";
  lastTxHash?: Hex;
  lastCycleId?: bigint;
  onRun: () => void;
}) {
  const active = phaseIndex(step);
  const hasTx = !!lastTxHash && lastTxHash !== "0x";

  return (
    <Card withBorder radius="lg" padding="xl" shadow="sm">
      <Stack gap="md">
        <div>
          <Title order={4}>Rebalance</Title>
          <Text c="dimmed" size="sm" mt={4}>
            Read the live Mystic market, compute and sign the allocation inside
            the Flare TEE, then verify and enforce it on-chain via
            CurationController.executePlan (mandate caps, model fingerprint, TEE
            signature). Funds move only if the plan passes.
          </Text>
        </div>
        <Button
          size="md"
          color="flare"
          fullWidth
          onClick={onRun}
          loading={running}
          disabled={!configured || running}
        >
          {running ? "Working..." : "Run rebalance cycle"}
        </Button>
      </Stack>

      {running && (
        <Alert color="blue" variant="light" mt="md">
          <Group gap="xs" wrap="nowrap">
            <Loader size="xs" />
            <Text size="sm">
              {(step && STEP_TEXT[step]) ?? "Starting..."}
            </Text>
          </Group>
        </Alert>
      )}

      {!running && !error && lastMode === "tee" && hasTx && (
        <Alert color="teal" variant="light" mt="md" title="Cycle enforced on-chain">
          <Text size="sm">
            {lastCycleId !== undefined
              ? `Cycle #${lastCycleId.toString()} enforced by CurationController on Coston2`
              : "Plan enforced by CurationController on Coston2"}{" "}
            (computed and signed in the live Flare TEE).
          </Text>
          <Anchor
            href={explorerTx(lastTxHash as Hex)}
            target="_blank"
            rel="noreferrer"
            ff="monospace"
            size="xs"
          >
            View executePlan transaction on Coston2 explorer
          </Anchor>
        </Alert>
      )}

      {!running && !error && lastMode === "local" && (
        <Alert color="gray" variant="light" mt="md" title="Plan computed (client-side)">
          <Text size="sm">
            {lastCycleId !== undefined
              ? `Cycle #${lastCycleId.toString()} computed client-side`
              : "Plan computed client-side"}{" "}
            (TEE proxy offline). Not enforced on-chain: only the live Flare enclave
            holds the key CurationController verifies.
          </Text>
        </Alert>
      )}

      {!configured && (
        <Alert color="gray" variant="light" mt="md">
          The display vault is not configured. Fill ALLOCATION_DISPLAY (and a
          DEMO_SIGNER_KEY, or connect a Coston2 wallet) in{" "}
          <Text span ff="monospace">
            src/tee.config.ts
          </Text>{" "}
          to enable this action.
        </Alert>
      )}

      {configured && teeReady === false && !running && active < 0 && !lastMode && (
        <Alert color="blue" variant="light" mt="md" title="Local mode (ready)">
          This is the normal, working setup: the button computes the plan
          client-side and records it on-chain to the vault. Routing the compute
          step through a live Flare TEE is optional (set INSTRUCTION_SENDER +
          EXT_PROXY_URL in{" "}
          <Text span ff="monospace">
            src/tee.config.ts
          </Text>
          ).
        </Alert>
      )}

      {(running || active >= 0) && (
        <Stack gap="xs" mt="lg">
          {PHASES.map((p, i) => {
            const done = active > i || (active === 3 && i <= 3);
            const current = active === i && active < 3;
            return (
              <Group key={p.key} gap="sm" wrap="nowrap">
                <StepIcon done={done && !current} current={current} />
                <Text
                  size="sm"
                  c={done || current ? undefined : "dimmed"}
                  fw={current ? 600 : 400}
                >
                  {p.label}
                </Text>
              </Group>
            );
          })}
        </Stack>
      )}

      {error && (
        <Alert color="red" title="Cycle failed" mt="md" variant="light">
          {error}
        </Alert>
      )}
    </Card>
  );
}

function StepIcon({ done, current }: { done: boolean; current: boolean }) {
  if (current) {
    return (
      <Box w={22} style={{ display: "flex", justifyContent: "center" }}>
        <Loader size={16} />
      </Box>
    );
  }
  if (done) {
    return (
      <ThemeIcon size={22} radius="xl" color="teal" variant="light">
        <CheckMark />
      </ThemeIcon>
    );
  }
  return (
    <ThemeIcon size={22} radius="xl" color="gray" variant="light">
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: "var(--mantine-color-gray-5)",
        }}
      />
    </ThemeIcon>
  );
}

function CheckMark() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
