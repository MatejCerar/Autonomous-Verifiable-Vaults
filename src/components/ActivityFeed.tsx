// ACTIVITY feed: recent CyclePushed events from the vault, newest first, capped
// at ~10 rows. Each row links to that cycle's on-chain write tx on the Coston2
// explorer. For the cycle just run this session, the instruction tx hash is also
// shown.
// No emojis, no em dashes (house style).
import {
  Anchor,
  Card,
  Group,
  Loader,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { Hex } from "viem";
import { explorerTx } from "@/tee.config";
import type { CycleEvent } from "./cycles";
import { relativeTime, shortHex, summaryLine } from "./vault";

export function ActivityFeed({
  cycles,
  loading,
  now,
  sessionInstructionTx,
  sessionCycleId,
}: {
  cycles: CycleEvent[];
  loading: boolean;
  now: number;
  sessionInstructionTx?: Hex;
  sessionCycleId?: bigint;
}) {
  return (
    <Card withBorder radius="lg" padding="lg" shadow="sm">
      <Group gap="xs" align="center" mb="xs">
        <Title order={5}>Activity</Title>
        {loading && <Loader size="xs" />}
      </Group>
      <Text c="dimmed" size="xs">
        Recent on-chain cycles recorded by the vault
      </Text>

      {!loading && cycles.length === 0 && (
        <Text c="dimmed" size="sm" mt="md">
          No cycles recorded yet.
        </Text>
      )}

      {cycles.length > 0 && (
        <Table.ScrollContainer minWidth={520} mt="md">
          <Table verticalSpacing="sm" fz="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cycle</Table.Th>
                <Table.Th>Time</Table.Th>
                <Table.Th>Allocation</Table.Th>
                <Table.Th ta="right">Tx</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cycles.map((c) => {
                const isSession =
                  sessionCycleId !== undefined && c.cycleId === sessionCycleId;
                return (
                  <Table.Tr key={c.txHash + c.cycleId.toString()}>
                    <Table.Td>
                      <Text fw={600} ff="monospace">
                        #{c.cycleId.toString()}
                      </Text>
                    </Table.Td>
                    <Table.Td c="dimmed">
                      {relativeTime(Number(c.timestamp), now)}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {summaryLine(c.amounts, c.reserveAmount)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      {c.txHash && c.txHash !== "0x" ? (
                        <Anchor
                          href={explorerTx(c.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          ff="monospace"
                          size="xs"
                        >
                          {shortHex(c.txHash)}
                        </Anchor>
                      ) : (
                        <Text c="dimmed" size="xs">
                          on-chain
                        </Text>
                      )}
                      {isSession && sessionInstructionTx && (
                        <Text c="dimmed" size="xs" mt={2}>
                          instr{" "}
                          <Anchor
                            href={explorerTx(sessionInstructionTx)}
                            target="_blank"
                            rel="noreferrer"
                            ff="monospace"
                            size="xs"
                          >
                            {shortHex(sessionInstructionTx)}
                          </Anchor>
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}
