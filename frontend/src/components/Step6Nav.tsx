import { Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import { fmtToken } from "@/format";

export interface NavSnapshot {
  totalAssets: bigint;
  sharePrice: bigint;
}

export interface Step6NavProps {
  before?: NavSnapshot;
  after?: NavSnapshot;
  active: boolean;
}

export function Step6Nav({ before, after, active }: Step6NavProps) {
  const delta =
    before && after ? after.totalAssets - before.totalAssets : undefined;

  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>6. NAV after reconcile</Title>
        <Badge variant="light" color="gray">
          vault.totalAssets()
        </Badge>
      </Group>

      {!active || !before || !after ? (
        <Text c="dimmed" size="sm">
          run a successful cycle to compare NAV before / after
        </Text>
      ) : (
        <Stack gap="sm">
          <Group grow>
            <div>
              <Text size="xs" c="dimmed">
                totalAssets before
              </Text>
              <Text ff="monospace" size="lg">
                {fmtToken(before.totalAssets)}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                totalAssets after
              </Text>
              <Text ff="monospace" size="lg">
                {fmtToken(after.totalAssets)}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                delta
              </Text>
              <Text
                ff="monospace"
                size="lg"
                c={delta === 0n ? "dimmed" : delta && delta > 0n ? "teal" : "red"}
              >
                {delta !== undefined
                  ? `${delta >= 0n ? "+" : "-"}${fmtToken(delta < 0n ? -delta : delta)}`
                  : "-"}
              </Text>
            </div>
          </Group>
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed">
                share price before
              </Text>
              <Text ff="monospace">{fmtToken(before.sharePrice, 6)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                share price after
              </Text>
              <Text ff="monospace">{fmtToken(after.sharePrice, 6)}</Text>
            </div>
          </Group>
          <Text size="xs" c="dimmed">
            NAV-conserving: assets are relocated idle -&gt; venues + reserve, so
            totalAssets is unchanged by a clean cycle.
          </Text>
        </Stack>
      )}
    </Card>
  );
}
