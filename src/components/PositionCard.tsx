// CURRENT POSITION hero card: the on-chain best position read from
// AllocationDisplay.latest() + cycleCount(). Renders a stacked bar and a
// per-venue table, the large total, cycle number, and "updated <relative>".
// Before the first cycle (zeroed), shows a clean empty state.
// No emojis, no em dashes (house style).
import {
  Badge,
  Box,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { OnChainCycle } from "@/tee";
import { StackedBar } from "./StackedBar";
import {
  buildSlices,
  fmtDollars,
  fmtPercent,
  isEmptyCycle,
  relativeTime,
  usdFromWei,
} from "./vault";

export function PositionCard({
  cycle,
  cycleCount,
  loading,
  error,
  now,
}: {
  cycle?: OnChainCycle;
  cycleCount?: bigint;
  loading: boolean;
  error?: string;
  now: number;
}) {
  const empty =
    !cycle || isEmptyCycle(cycle.cycleId, cycle.totalOut, cycle.reserveAmount);

  return (
    <Card withBorder radius="lg" padding="xl" shadow="sm">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="xs" align="center">
          <Title order={4}>Current position</Title>
          {loading && <Loader size="xs" />}
        </Group>
        {cycleCount !== undefined && !empty && (
          <Badge variant="light" color="flare" radius="sm">
            Cycle #{cycleCount.toString()}
          </Badge>
        )}
      </Group>

      {error && (
        <Text c="red" size="sm">
          Could not read the vault: {error}
        </Text>
      )}

      {!error && empty && <EmptyPosition loading={loading} />}

      {!error && !empty && cycle && (
        <FilledPosition cycle={cycle} now={now} />
      )}
    </Card>
  );
}

function EmptyPosition({ loading }: { loading: boolean }) {
  return (
    <Box py="lg">
      <Text size="lg" fw={600}>
        No cycle recorded yet
      </Text>
      <Text c="dimmed" size="sm" mt={4} maw={460}>
        {loading
          ? "Reading the vault state from Coston2..."
          : "The vault has no allocation on record. Run a rebalance cycle to compute the best position in the Flare TEE and write it on-chain."}
      </Text>
    </Box>
  );
}

function FilledPosition({ cycle, now }: { cycle: OnChainCycle; now: number }) {
  const { slices, totalWei } = buildSlices(cycle.amounts, cycle.reserveAmount);
  const total = usdFromWei(totalWei);
  const updated = relativeTime(Number(cycle.timestamp), now);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text c="dimmed" size="xs" tt="uppercase" fw={600} lts={0.5}>
            Total allocated
          </Text>
          <Text
            style={{ fontSize: 40, lineHeight: 1.1 }}
            fw={700}
            ff="monospace"
          >
            {fmtDollars(total)}
          </Text>
        </div>
        <Text c="dimmed" size="sm">
          updated {updated}
        </Text>
      </Group>

      <StackedBar slices={slices} />

      <Table verticalSpacing="sm" withRowBorders={false}>
        <Table.Tbody>
          {slices.map((s) => (
            <Table.Tr key={s.key}>
              <Table.Td style={{ width: 24 }}>
                <Box
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: s.color,
                  }}
                />
              </Table.Td>
              <Table.Td>
                <Text fw={550}>{s.label}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text ff="monospace">{fmtDollars(usdFromWei(s.usd))}</Text>
              </Table.Td>
              <Table.Td ta="right" style={{ width: 80 }}>
                <Text c="dimmed" ff="monospace">
                  {fmtPercent(s.frac)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
