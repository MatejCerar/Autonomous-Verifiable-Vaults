// LIVE INPUTS card. The FLR/USD and XRP/USD prices are read live from Coston2
// FTSO by THIS component (self-contained, not threaded through app state), so
// they are always fresh. The per-venue APY / utilization rows come from the
// snapshot the app passes.
// No emojis, no em dashes (house style).
import { useEffect, useState } from "react";
import { Card, Group, Stack, Table, Text, Title } from "@mantine/core";
import type { MarketData } from "@/data";
import { readLivePrices } from "@/live";
import { GATEWAY_URL, gatewayConfigured } from "@/tee.config";
import { fmtPercent } from "./vault";

export function LiveInputs({
  market,
  asOf,
}: {
  market?: MarketData;
  asOf?: string;
}) {
  // Self-fetch the live market (this component, not app state). Prefer the
  // enclave's live Mystic market (prices + venue APY/util); fall back to a
  // Coston2 FTSO price-only read. On mount and every 15s.
  const [mkt, setMkt] = useState<MarketData>();
  const [live, setLive] = useState<{ flr: number; xrp: number; at: string }>();
  const [priceError, setPriceError] = useState<string>();
  useEffect(() => {
    let on = true;
    const read = async () => {
      if (gatewayConfigured()) {
        try {
          const res = await fetch(`${GATEWAY_URL.replace(/\/+$/, "")}/market`);
          const body = (await res.json()) as { market?: MarketData };
          if (on && body?.market?.assets) {
            setMkt(body.market);
            setPriceError(undefined);
            return;
          }
        } catch {
          // fall through to the Coston2 price-only read
        }
      }
      try {
        const p = await readLivePrices();
        if (on) {
          setLive({ flr: p.flrUsd, xrp: p.xrpUsd, at: p.at });
          setPriceError(undefined);
        }
      } catch (e) {
        console.warn("[AVV] LiveInputs price read failed:", e);
        if (on) setPriceError((e as Error).message ?? String(e));
      }
    };
    void read();
    const id = setInterval(read, 15_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  const displayMarket = mkt ?? market;
  const flrUsd = mkt?.prices.FLR_USD.value ?? live?.flr ?? market?.prices.FLR_USD.value;
  const xrpUsd = mkt?.prices.XRP_USD.value ?? live?.xrp ?? market?.prices.XRP_USD.value;
  const shownAt = mkt?.asOf ?? live?.at ?? asOf;

  return (
    <Card withBorder radius="lg" padding="lg" shadow="sm">
      <Title order={5}>Live inputs</Title>
      <Text c="dimmed" size="xs" mt={2}>
        {live ? "Live market (FTSO + Mystic), updating" : "Live market (FTSO + Mystic)"}
        ; venue rates from the market snapshot
      </Text>

      {priceError && (
        <Text c="red" size="xs" mt="xs">
          live price read failed: {priceError}
        </Text>
      )}

      {!displayMarket && flrUsd === undefined && !priceError && (
        <Text c="dimmed" size="sm" mt="md">
          Reading live prices...
        </Text>
      )}

      {(displayMarket || flrUsd !== undefined) && (
        <Stack gap="md" mt="md">
          <Group grow>
            <PriceStat label="FLR / USD" value={flrUsd ?? 0} />
            <PriceStat label="XRP / USD" value={xrpUsd ?? 0} />
          </Group>

          {displayMarket && (
          <Table verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Venue</Table.Th>
                <Table.Th ta="right">Supply APY</Table.Th>
                <Table.Th ta="right">Utilization</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {displayMarket.assets.map((a) => (
                <Table.Tr key={a.symbol}>
                  <Table.Td>
                    <Text fw={550}>{a.symbol}</Text>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {fmtPercent(a.supplyApy, 2)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c="dimmed">
                    {fmtPercent(a.utilization, 1)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          )}

          {shownAt && (
            <Text c="dimmed" size="xs" ff="monospace">
              as of {new Date(shownAt).toLocaleTimeString()}
            </Text>
          )}
        </Stack>
      )}
    </Card>
  );
}

function PriceStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <Text c="dimmed" size="xs" tt="uppercase" fw={600} lts={0.4}>
        {label}
      </Text>
      <Text ff="monospace" fw={600} size="lg">
        $
        {value.toLocaleString(undefined, {
          maximumFractionDigits: 4,
          minimumFractionDigits: 2,
        })}
      </Text>
    </div>
  );
}
