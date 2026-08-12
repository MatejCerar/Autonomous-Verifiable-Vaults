import { Badge, Card, Code, Group, Stack, Table, Text, Title } from "@mantine/core";
import type { Envelope } from "@/model";
import { fmtToken, truncateHex } from "@/format";

export interface Step3PlanProps {
  envelope?: Envelope;
}

export function Step3Plan({ envelope }: Step3PlanProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>3. Signed bounded plan</Title>
        <Badge variant="light" color="teal">
          signer = registered TEE key
        </Badge>
      </Group>

      {!envelope && (
        <Text c="dimmed" size="sm">
          no plan yet
        </Text>
      )}

      {envelope && (
        <Stack gap="sm">
          <Table withRowBorders={false} verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>venueId</Table.Th>
                <Table.Th ta="right">amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {envelope.plan.allocations.map((a, i) => (
                <Table.Tr key={`${a.venueId}-${i}`}>
                  <Table.Td ff="monospace">{a.venueId}</Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {fmtToken(a.amount)}
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td c="dimmed">reserve</Table.Td>
                <Table.Td ta="right" ff="monospace" c="dimmed">
                  {fmtToken(envelope.plan.reserveAmount)}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>totalOut</Table.Td>
                <Table.Td ta="right" ff="monospace" fw={600}>
                  {fmtToken(envelope.plan.totalOut)}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed">
                planId
              </Text>
              <Code>{truncateHex(envelope.plan.planId)}</Code>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                nonce
              </Text>
              <Text ff="monospace">{envelope.plan.nonce}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                signature (65-byte EIP-191)
              </Text>
              <Code>{truncateHex(envelope.signature, 12, 10)}</Code>
            </div>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
