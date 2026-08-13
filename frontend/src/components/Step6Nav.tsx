import {
  Badge,
  Card,
  Group,
  List,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import type { DemoData } from "@/data";
import { fmtPct, fmtUsd } from "@/format";

export interface Step6NavProps {
  data?: DemoData;
}

const REAL: string[] = [
  "Live market data: Mystic / Morpho vault + token addresses, TVL, utilization, LLTV, available liquidity",
  "Live FTSO V2 prices: FLR/USD and XRP/USD read on Flare mainnet",
  "The optimizer: risk-adjusted water-filling under caps, actual weights and reserve",
  "The TEE signature: a real EIP-191 signature over the bounded plan (planId, nonce, expiry, allocations)",
  "Cap enforcement: the mandate checks (30% venue, 80% total-out, 20% reserve floor) evaluated exactly as on-chain",
  "Real calldata: 6 unsigned Flare-mainnet transactions (approve + deposit per venue) with decoded args",
];

const SIMULATED: string[] = [
  "Hardware attestation: the Confidential Space JWT is a stub, not hardware-verified. Swap the signer for a tee-node enclave; contracts are unchanged",
  "Not broadcast: Mystic is Flare mainnet only, so nothing is signed or sent. The transactions are prepared for later review and signing",
  "annualizedVol, pairwise correlation and the USDT0 = 1.0 peg are labeled risk-model estimates",
];

export function Step6Nav({ data }: Step6NavProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>6. Summary</Title>
        <Badge variant="light" color="gray">
          real vs simulated
        </Badge>
      </Group>

      {!data ? (
        <Text c="dimmed" size="sm">
          loading...
        </Text>
      ) : (
        <Stack gap="md">
          <Group gap="xl">
            <Stat label="capital" value={fmtUsd(data.optimizer.capital)} />
            <Stat
              label="deployed"
              value={fmtPct(1 - data.optimizer.reserve)}
            />
            <Stat label="reserve" value={fmtPct(data.optimizer.reserve)} />
            <Stat
              label="expected APY"
              value={fmtPct(data.optimizer.expectedApy)}
            />
            <Stat
              label="prepared txs"
              value={String(data.bundle.transactions.length)}
            />
          </Group>

          <div>
            <Text fw={600} size="sm" mb={4} c="teal">
              REAL in this demo
            </Text>
            <List size="sm" spacing={4} icon={<Dot color="teal" />}>
              {REAL.map((t) => (
                <List.Item key={t}>{t}</List.Item>
              ))}
            </List>
          </div>

          <div>
            <Text fw={600} size="sm" mb={4} c="yellow">
              SIMULATED / not broadcast
            </Text>
            <List size="sm" spacing={4} icon={<Dot color="yellow" />}>
              {SIMULATED.map((t) => (
                <List.Item key={t}>{t}</List.Item>
              ))}
            </List>
          </div>
        </Stack>
      )}
    </Card>
  );
}

function Dot({ color }: { color: string }) {
  return <ThemeIcon color={color} size={12} radius="xl" mt={6} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text ff="monospace" fw={600}>
        {value}
      </Text>
    </div>
  );
}
