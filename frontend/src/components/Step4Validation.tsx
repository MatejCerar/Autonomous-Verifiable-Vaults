import { Anchor, Badge, Card, Code, Group, Stack, Text, Title } from "@mantine/core";
import type { ExecuteResult } from "@/execute";
import { VALIDATION_CHECKS, checkStates, type CheckState } from "@/steps";
import { truncateHex } from "@/format";

export interface Step4ValidationProps {
  result?: ExecuteResult;
  ran: boolean;
}

function dot(state: CheckState): { color: string; glyph: string } {
  switch (state) {
    case "pass":
      return { color: "teal", glyph: "PASS" };
    case "fail":
      return { color: "red", glyph: "REJECT" };
    default:
      return { color: "gray", glyph: "-" };
  }
}

export function Step4Validation({ result, ran }: Step4ValidationProps) {
  const states = checkStates(result?.revert, ran);
  const rejected = ran && result && !result.ok;

  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>4. On-chain validation</Title>
        {ran && result?.ok && (
          <Badge color="teal" variant="filled">
            all checks passed
          </Badge>
        )}
        {rejected && (
          <Badge color="red" variant="filled">
            REJECTED{result?.revert ? `: "${result.revert}"` : ""}
          </Badge>
        )}
      </Group>

      <Stack gap={6}>
        {VALIDATION_CHECKS.map((c) => {
          const d = dot(states[c.reason]);
          return (
            <Group key={c.reason} justify="space-between" gap="xs">
              <Group gap="xs">
                <Badge
                  color={d.color}
                  variant={states[c.reason] === "idle" ? "outline" : "filled"}
                  w={78}
                >
                  {d.glyph}
                </Badge>
                <Text
                  size="sm"
                  c={states[c.reason] === "fail" ? "red" : undefined}
                  fw={states[c.reason] === "fail" ? 600 : 400}
                >
                  {c.label}
                </Text>
              </Group>
              <Code c="dimmed">{c.reason}</Code>
            </Group>
          );
        })}
      </Stack>

      {ran && result?.ok && result.txHash && (
        <Text size="xs" c="dimmed" mt="sm">
          tx:{" "}
          <Anchor
            href={`https://coston2-explorer.flare.network/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            <Code>{truncateHex(result.txHash, 12, 10)}</Code>
          </Anchor>{" "}
          (view on Coston2 explorer; no revert, funds moved atomically)
        </Text>
      )}
      {rejected && !result?.revert && result?.error && (
        <Text size="xs" c="red" mt="sm">
          {result.error}
        </Text>
      )}
      {rejected && (
        <Text size="xs" c="dimmed" mt="sm">
          reverted before any adapter.allocate: no funds moved, steps 5-6
          untouched.
        </Text>
      )}
    </Card>
  );
}
