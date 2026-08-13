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
import { evaluateMandate, MANDATE, type CheckState } from "@/mandate";
import { fmtBips } from "@/format";

export interface Step4ValidationProps {
  envelope?: Envelope;
  envelopeBad?: Envelope;
  showBad: boolean;
  onToggle: (bad: boolean) => void;
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

export function Step4Validation({
  envelope,
  envelopeBad,
  showBad,
  onToggle,
}: Step4ValidationProps) {
  const active = showBad ? envelopeBad : envelope;
  const result = active ? evaluateMandate(active) : undefined;

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
          value={showBad ? "bad" : "good"}
          onChange={(v) => onToggle(v === "bad")}
          data={[
            { label: "signed plan", value: "good" },
            { label: "bad plan", value: "bad" },
          ]}
          disabled={!envelopeBad}
        />
      </Group>

      {!result && (
        <Text c="dimmed" size="sm">
          loading plan...
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

      {result?.reject && (
        <Text size="xs" c="dimmed" mt="sm">
          The controller reverts on the first failing check before releasing any
          funds. The bad plan over-allocates venue #0 (FXRP) to 40% of budget,
          tripping the 30% venue cap; no capital moves.
        </Text>
      )}
      {result && !result.reject && (
        <Text size="xs" c="dimmed" mt="sm">
          Every allocation is within its cap, total deployed stays under 80%, and
          reserve holds above its 20% floor. The signed plan would be accepted.
        </Text>
      )}
    </Card>
  );
}
