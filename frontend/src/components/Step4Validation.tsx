import { useEffect, useState } from "react";
import {
  Badge,
  Card,
  Code,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { Envelope } from "@/data";
import {
  deriveMandateRef,
  evaluateMandate,
  MANDATE,
  type CheckState,
  type MandateResult,
} from "@/mandate";
import { fmtBips } from "@/format";

export type Scenario = "good" | "overcap" | "badsigner";

export interface Step4ValidationProps {
  envelope?: Envelope;
  envelopeBad?: Envelope;
  envelopeBadSigner?: Envelope;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}

function glyph(state: CheckState): { color: string; text: string } {
  switch (state) {
    case "pass":
      return { color: "teal", text: "PASS" };
    case "fail":
      return { color: "red", text: "REJECT" };
    default:
      return { color: "gray", text: "-" };
  }
}

const SCENARIO_NOTE: Record<Scenario, string> = {
  good: "Every allocation is within its cap, total deployed stays under 80%, reserve holds above its 20% floor, and the plan is signed by the registered TEE enclave. The signed plan is accepted.",
  overcap:
    "The controller reverts on the first failing check before releasing any funds. This plan over-allocates venue #0 (FXRP) to 40% of budget, tripping the 30% venue cap; no capital moves.",
  badsigner:
    "Verify, don't trust: this plan is perfectly in-mandate (every cap satisfied, reserve above floor, valid fingerprint), yet it is REJECTED because it was signed by an enclave key that is NOT the one registered in the mandate. Even a flawless plan from the wrong enclave releases no funds.",
};

export function Step4Validation({
  envelope,
  envelopeBad,
  envelopeBadSigner,
  scenario,
  onScenario,
}: Step4ValidationProps) {
  const active =
    scenario === "overcap"
      ? envelopeBad
      : scenario === "badsigner"
        ? envelopeBadSigner
        : envelope;

  const [result, setResult] = useState<MandateResult>();
  const [evalError, setEvalError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    setEvalError(undefined);
    if (!envelope || !active) return;
    (async () => {
      try {
        // The valid envelope defines the mandate reference: its signer is the
        // registered TEE enclave and its codeHash is the enabled fingerprint.
        const ref = await deriveMandateRef(envelope);
        const r = await evaluateMandate(active, ref);
        if (!cancelled) setResult(r);
      } catch (e) {
        if (!cancelled) setEvalError((e as Error).message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [envelope, active]);

  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>4. On-chain mandate validation</Title>
        {result &&
          (result.reject ? (
            <Badge color="red" variant="filled">
              REJECTED: "{result.reject}"
            </Badge>
          ) : (
            <Badge color="teal" variant="filled">
              all checks passed
            </Badge>
          ))}
      </Group>

      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">
          caps: venue {fmtBips(MANDATE.venueCapBips)} | total-out{" "}
          {fmtBips(MANDATE.maxTotalOutBips)} | reserve floor{" "}
          {fmtBips(MANDATE.minReserveBips)}
        </Text>
        <SegmentedControl
          size="xs"
          value={scenario}
          onChange={(v) => onScenario(v as Scenario)}
          data={[
            { label: "signed plan", value: "good" },
            { label: "over-cap", value: "overcap", disabled: !envelopeBad },
            {
              label: "bad signer",
              value: "badsigner",
              disabled: !envelopeBadSigner,
            },
          ]}
        />
      </Group>

      {evalError && (
        <Text c="red" size="sm">
          validation error: {evalError}
        </Text>
      )}

      {!result && !evalError && (
        <Text c="dimmed" size="sm">
          evaluating plan...
        </Text>
      )}

      {result && (
        <Stack gap={6}>
          {result.rows.map((r) => {
            const g = glyph(r.state);
            return (
              <Group key={r.key} justify="space-between" gap="xs" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <Badge
                    color={g.color}
                    variant={r.state === "idle" ? "outline" : "filled"}
                    w={78}
                  >
                    {g.text}
                  </Badge>
                  <Text
                    size="sm"
                    c={r.state === "fail" ? "red" : undefined}
                    fw={r.state === "fail" ? 600 : 400}
                  >
                    {r.label}
                  </Text>
                </Group>
                <Code c={r.state === "fail" ? "red" : "dimmed"}>{r.detail}</Code>
              </Group>
            );
          })}
        </Stack>
      )}

      {result && (
        <Text size="xs" c="dimmed" mt="sm">
          {SCENARIO_NOTE[scenario]}
        </Text>
      )}
    </Card>
  );
}
