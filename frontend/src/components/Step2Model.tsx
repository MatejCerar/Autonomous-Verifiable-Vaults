import {
  Alert,
  Badge,
  Card,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { OptimizerResult } from "@/data";
import { LabeledBar } from "@/components/Bars";
import { fmtPct, fmtUsd } from "@/format";

export interface Step2ModelProps {
  optimizer?: OptimizerResult;
}

// One-paragraph plain-language summary of the allocation equation, distilled
// from optimizer/EQUATION.md (water-filling under caps).
const EQUATION_SUMMARY =
  "The optimizer spreads a stablecoin-denominated vault across three Mystic / " +
  "Morpho supply markets plus a defensive reserve to maximize risk-adjusted " +
  "yield under hard caps. Each market has a diminishing-return yield curve: a " +
  "deposit lowers utilization, so the marginal yield of the next dollar falls. " +
  "Capital is poured venue by venue like water-filling: every funded venue is " +
  "topped up until its risk-adjusted marginal yield meets a common water line, " +
  "or it hits its cap (30% per venue, 80% total) or its available liquidity. " +
  "A risk term (lambda times the covariance of asset price moves) penalizes " +
  "volatile, correlated venues. Whatever the caps and liquidity leave undeployed " +
  "goes to reserve, which must stay above its 20% floor.";

function constraintColor(c: string): string {
  if (c.includes("cap")) return "grape";
  if (c.includes("liquidity")) return "orange";
  return "gray";
}

export function Step2Model({ optimizer }: Step2ModelProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>2. The optimizer (runs inside the TEE)</Title>
        <Badge variant="light" color="grape">
          risk-adjusted yield max
        </Badge>
      </Group>

      {!optimizer && (
        <Text c="dimmed" size="sm">
          loading optimizer result...
        </Text>
      )}

      {optimizer && (
        <Stack gap="md">
          <Text size="sm">{EQUATION_SUMMARY}</Text>

          <Group gap="xl">
            <Stat label="expected APY" value={fmtPct(optimizer.expectedApy)} />
            <Stat
              label="risk-adj APY"
              value={fmtPct(optimizer.expectedRiskAdjApy)}
            />
            <Stat label="reserve" value={fmtPct(optimizer.reserve)} />
            <Stat
              label="lambda (risk aversion)"
              value={optimizer.params.lambda.toString()}
            />
            <Stat label="capital" value={fmtUsd(optimizer.capital)} />
          </Group>

          <Table withRowBorders={false} verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>venue</Table.Th>
                <Table.Th>weight</Table.Th>
                <Table.Th ta="right">USD</Table.Th>
                <Table.Th ta="right">APY post-deposit</Table.Th>
                <Table.Th>binding constraint</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {optimizer.perVenue.map((v) => (
                <Table.Tr key={v.symbol}>
                  <Table.Td fw={600}>{v.symbol}</Table.Td>
                  <Table.Td style={{ minWidth: 160 }}>
                    <LabeledBar
                      value={v.weight}
                      max={optimizer.params.cap}
                      display={fmtPct(v.weight)}
                      color="#fe256d"
                    />
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm">
                    {fmtUsd(v.amountUsd)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" fz="sm">
                    {fmtPct(v.supplyApyPostDeposit)}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={constraintColor(v.bindingConstraint)}
                    >
                      {v.bindingConstraint}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td c="dimmed">reserve</Table.Td>
                <Table.Td style={{ minWidth: 160 }}>
                  <LabeledBar
                    value={optimizer.reserve}
                    max={1}
                    display={fmtPct(optimizer.reserve)}
                    color="#495057"
                  />
                </Table.Td>
                <Table.Td ta="right" ff="monospace" fz="sm" c="dimmed">
                  {fmtUsd(optimizer.reserve * optimizer.capital)}
                </Table.Td>
                <Table.Td />
                <Table.Td c="dimmed" fz="sm">
                  defensive sink
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          <Alert variant="light" color="grape" title="Why this allocation">
            <Text size="sm">{optimizer.rationale}</Text>
            <Text size="xs" c="dimmed" mt={6}>
              USDT0 hits its 30% venue cap (best risk-adjusted marginal yield,
              stable, high liquidity). WFLR is clamped by its thin available
              liquidity (~$32k instantly withdrawable) despite the highest
              headline APY. FXRP sits interior on the water line. The remaining
              {" "}
              {fmtPct(optimizer.reserve)} stays in reserve above its 20% floor.
            </Text>
          </Alert>
        </Stack>
      )}
    </Card>
  );
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
