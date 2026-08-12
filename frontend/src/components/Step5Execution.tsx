import { Badge, Card, Group, Progress, Stack, Text, Title } from "@mantine/core";
import type { VenueState } from "@/execute";
import { fmtBips, fmtToken, truncateHex } from "@/format";

export interface Step5ExecutionProps {
  venues?: VenueState[];
  reserve?: bigint;
  active: boolean;
}

export function Step5Execution({ venues, reserve, active }: Step5ExecutionProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>5. Capped execution</Title>
        <Badge variant="light" color="gray">
          amount vs cap
        </Badge>
      </Group>

      {!active || !venues ? (
        <Text c="dimmed" size="sm">
          run a successful cycle to see venue allocations
        </Text>
      ) : (
        <Stack gap="md">
          {venues.map((v) => {
            const pct =
              v.capAmount > 0n
                ? Number((v.balance * 10000n) / v.capAmount) / 100
                : 0;
            const over = v.capAmount > 0n && v.balance > v.capAmount;
            return (
              <div key={v.adapter}>
                <Group justify="space-between" gap="xs" mb={2}>
                  <Text size="sm" fw={500}>
                    venue #{v.venueId}{" "}
                    <Text span c="dimmed" size="xs" ff="monospace">
                      {truncateHex(v.adapter, 8, 6)}
                    </Text>
                  </Text>
                  <Text size="sm" ff="monospace">
                    {fmtToken(v.balance)} / {fmtToken(v.capAmount)}
                    <Text span c="dimmed" size="xs">
                      {" "}
                      (cap {fmtBips(v.capBips)} TVL)
                    </Text>
                  </Text>
                </Group>
                <Progress
                  value={Math.min(pct, 100)}
                  color={over ? "red" : "flare"}
                  size="lg"
                  radius="sm"
                />
              </div>
            );
          })}

          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              reserve (defensive sink)
            </Text>
            <Text size="sm" ff="monospace">
              {reserve !== undefined ? fmtToken(reserve) : "-"}
            </Text>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
