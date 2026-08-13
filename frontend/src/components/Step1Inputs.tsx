import {
  Badge,
  Card,
  Group,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type { MarketData } from "@/data";
import { LabeledBar } from "@/components/Bars";
import { fmtDateTime, fmtPct, fmtUsdCompact } from "@/format";

export interface Step1InputsProps {
  market?: MarketData;
  loading: boolean;
  error?: string;
}

// Highest APY across venues, used to scale the APY bars.
function apyMax(m: MarketData): number {
  return Math.max(...m.assets.map((a) => a.supplyApy), 0.01);
}

export function Step1Inputs({ market, loading, error }: Step1InputsProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>1. Live market inputs</Title>
        <Badge variant="light" color="gray">
          Mystic / Morpho on Flare (chainId 14)
        </Badge>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {loading && !market && (
        <Text c="dimmed" size="sm">
          loading market snapshot...
        </Text>
      )}

      {market && (
        <Stack gap="md">
          <Group gap="xl">
            <PriceStat
              label="FLR / USD"
              value={market.prices.FLR_USD.value}
              dp={6}
            />
            <PriceStat
              label="XRP / USD"
              value={market.prices.XRP_USD.value}
              dp={4}
            />
            <PriceStat
              label="USDT0 / USD"
              value={market.prices.USDT0_USD.value}
              dp={4}
              note="assumed peg"
            />
            <div>
              <Text size="xs" c="dimmed">
                snapshot
              </Text>
              <Text ff="monospace" size="sm">
                {fmtDateTime(market.asOf)}
              </Text>
            </div>
          </Group>

          <Table
            withRowBorders={false}
            verticalSpacing="sm"
            horizontalSpacing="md"
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>venue</Table.Th>
                <Table.Th>supply APY</Table.Th>
                <Table.Th>utilization</Table.Th>
                <Table.Th ta="right">avail. liq.</Table.Th>
                <Table.Th ta="right">TVL</Table.Th>
                <Table.Th ta="right">LLTV</Table.Th>
                <Table.Th ta="right">price</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {market.assets.map((a) => (
                <Table.Tr key={a.symbol}>
                  <Table.Td>
                    <Text fw={600} size="sm">
                      {a.symbol}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {a.vaultName}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ minWidth: 150 }}>
                    <LabeledBar
                      value={a.supplyApy}
                      max={apyMax(market)}
                      display={fmtPct(a.supplyApy)}
                      color="#fe256d"
                    />
                  </Table.Td>
                  <Table.Td style={{ minWidth: 150 }}>
                    <LabeledBar
                      value={a.utilization}
                      max={1}
                      display={fmtPct(a.utilization, 1)}
                      color={a.utilization > 0.92 ? "#e03131" : "#f59f00"}
                    />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Tooltip
                      multiline
                      w={260}
                      label={a.availableLiquidityNote ?? ""}
                      disabled={!a.availableLiquidityNote}
                    >
                      <Text ff="monospace" size="sm">
                        {fmtUsdCompact(a.availableLiquidityUsd)}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm">
                    {fmtUsdCompact(a.tvlUsd)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm">
                    {fmtPct(a.lltv, 1)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm">
                    {a.priceUsd < 0.01
                      ? `$${a.priceUsd.toFixed(6)}`
                      : `$${a.priceUsd.toFixed(4)}`}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>

          <Text size="xs" c="dimmed">
            REAL: vault + token addresses, TVL, utilization, LLTV, available
            liquidity and FTSO FLR/USD + XRP/USD are live on-chain reads.
            annualizedVol, correlations and the USDT0 peg are labeled estimates
            for the risk model.
          </Text>
        </Stack>
      )}
    </Card>
  );
}

function PriceStat({
  label,
  value,
  dp,
  note,
}: {
  label: string;
  value: number;
  dp: number;
  note?: string;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xl" fw={600} ff="monospace">
        ${value.toFixed(dp)}
      </Text>
      {note && (
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      )}
    </div>
  );
}
