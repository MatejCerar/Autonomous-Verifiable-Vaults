import {
  Alert,
  Badge,
  Card,
  Code,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { Envelope } from "@/data";
import { fmtUsdBig } from "@/mandate";
import { fmtTimestamp, truncateHex } from "@/format";

export interface Step3PlanProps {
  envelope?: Envelope;
  live?: boolean;
}

const VENUE_NAMES: Record<string, string> = {
  "0": "FXRP",
  "1": "USDT0",
  "2": "WFLR",
};

export function Step3Plan({ envelope, live }: Step3PlanProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>3. TEE-signed bounded plan</Title>
        <Group gap="xs">
          {live && (
            <Badge variant="filled" color="pink">
              re-signed this cycle
            </Badge>
          )}
          <Badge variant="light" color="teal">
            signer = registered TEE key
          </Badge>
        </Group>
      </Group>

      {!envelope && (
        <Text c="dimmed" size="sm">
          loading signed plan...
        </Text>
      )}

      {envelope && (
        <Stack gap="sm">
          <Table withRowBorders={false} verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>venue</Table.Th>
                <Table.Th ta="right">allocation (USD notional)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {envelope.plan.allocations.map((a, i) => (
                <Table.Tr key={`${a.venueId}-${i}`}>
                  <Table.Td>
                    <Text span fw={600} size="sm">
                      {VENUE_NAMES[a.venueId] ?? `#${a.venueId}`}
                    </Text>{" "}
                    <Text span c="dimmed" size="xs" ff="monospace">
                      (venueId {a.venueId})
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {fmtUsdBig(BigInt(a.amount))}
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td c="dimmed">reserve</Table.Td>
                <Table.Td ta="right" ff="monospace" c="dimmed">
                  {fmtUsdBig(BigInt(envelope.plan.reserveAmount))}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>totalOut (budget)</Table.Td>
                <Table.Td ta="right" ff="monospace" fw={600}>
                  {fmtUsdBig(BigInt(envelope.plan.totalOut))}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          <Group gap="xl">
            <Field label="planId">
              <Code>{truncateHex(envelope.plan.planId)}</Code>
            </Field>
            <Field label="nonce">
              <Text ff="monospace">{envelope.plan.nonce}</Text>
            </Field>
            <Field label="expiry">
              <Text ff="monospace" size="sm">
                {fmtTimestamp(envelope.plan.expiry)}
              </Text>
            </Field>
            <Field label="modelVersion">
              <Text ff="monospace">{envelope.plan.modelVersion}</Text>
            </Field>
          </Group>

          <Group gap="xl">
            <Field label="codeHash (image fingerprint)">
              <Code>{truncateHex(envelope.plan.codeHash)}</Code>
            </Field>
            <Field label="inputHash">
              <Code>{truncateHex(envelope.inputHash)}</Code>
            </Field>
            <Field label="signature (65-byte EIP-191)">
              <Code>{truncateHex(envelope.signature, 12, 10)}</Code>
            </Field>
          </Group>

          <Alert
            variant="light"
            color="yellow"
            title="attestation: SIMULATED for PoC"
          >
            <Text size="sm">{envelope.attestation.note}</Text>
            {envelope.attestation.claims?.platform && (
              <Text size="xs" c="dimmed" mt={4}>
                platform: {envelope.attestation.claims.platform}
                {envelope.attestation.claims.image_digest
                  ? ` | image: ${truncateHex(envelope.attestation.claims.image_digest)}`
                  : ""}
              </Text>
            )}
          </Alert>
        </Stack>
      )}
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {children}
    </div>
  );
}
