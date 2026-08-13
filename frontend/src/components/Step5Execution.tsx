import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import type { PreparedBundle, PreparedTx } from "@/data";
import { addresses, explorerAddressUrl } from "@/addresses";
import { fmtTokenUnits, fmtUsd, truncateHex } from "@/format";

export interface Step5ExecutionProps {
  bundle?: PreparedBundle;
}

function isApprove(tx: PreparedTx): boolean {
  return tx.decoded.fn.startsWith("approve");
}

export function Step5Execution({ bundle }: Step5ExecutionProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>5. Prepared transactions</Title>
        <Badge variant="light" color="orange">
          unsigned | chainId 14
        </Badge>
      </Group>

      <Alert color="orange" variant="filled" mb="md" title="PREPARED, NOT BROADCAST">
        <Text size="sm">
          Mystic is Flare mainnet only and this demo does not sign or send. The
          {bundle ? ` ${bundle.transactions.length}` : ""} transactions below are
          ready to sign and send later. Review before broadcast.
        </Text>
      </Alert>

      {!bundle && (
        <Text c="dimmed" size="sm">
          loading prepared bundle...
        </Text>
      )}

      {bundle && (
        <Stack gap="sm">
          <Group gap="xl">
            <Stat
              label="capital"
              value={fmtUsd(bundle.header.capitalUsd)}
            />
            <Stat
              label="reserve (undeployed)"
              value={fmtUsd(bundle.header.reserveUsdUndeployed)}
            />
            <Stat label="receiver" value={truncateHex(bundle.header.receiver)} />
          </Group>

          {bundle.header.receiverNote && (
            <Text size="xs" c="dimmed">
              {bundle.header.receiverNote}
            </Text>
          )}

          <Stack gap="xs">
            {bundle.transactions.map((tx, i) => (
              <Card
                key={i}
                withBorder
                radius="sm"
                padding="sm"
                bg="rgba(255,255,255,0.02)"
              >
                <Group justify="space-between" gap="xs" mb={4}>
                  <Group gap="xs">
                    <Badge
                      size="sm"
                      variant="light"
                      color={isApprove(tx) ? "gray" : "flare"}
                    >
                      #{i + 1} {isApprove(tx) ? "approve" : "deposit"}
                    </Badge>
                    <Text size="sm" fw={500}>
                      {tx.label}
                    </Text>
                  </Group>
                  <Group gap="xs">
                    <Badge size="sm" variant="outline" color="gray">
                      {tx.symbol}
                    </Badge>
                    <Badge size="sm" variant="outline" color="gray">
                      value {tx.value}
                    </Badge>
                  </Group>
                </Group>

                <Group gap="xs" mb={2}>
                  <Text size="xs" c="dimmed" w={40}>
                    to
                  </Text>
                  <Anchor
                    href={explorerAddressUrl(tx.to)}
                    target="_blank"
                    rel="noreferrer"
                    size="xs"
                    ff="monospace"
                  >
                    {tx.to}
                  </Anchor>
                </Group>
                <Group gap="xs" mb={2} align="flex-start" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={40}>
                    fn
                  </Text>
                  <Code fz="xs">{tx.decoded.fn}</Code>
                </Group>
                <Group gap="xs" align="flex-start" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={40}>
                    args
                  </Text>
                  <Stack gap={0}>
                    {Object.entries(tx.decoded.args).map(([k, v]) => (
                      <Text key={k} size="xs" ff="monospace">
                        {k} ={" "}
                        <Text span c="dimmed">
                          {v}
                        </Text>
                      </Text>
                    ))}
                  </Stack>
                </Group>
                <Tooltip label={tx.data} multiline w={360} withArrow>
                  <Text size="xs" c="dimmed" mt={4} ff="monospace">
                    calldata {truncateHex(tx.data, 12, 8)}
                  </Text>
                </Tooltip>
              </Card>
            ))}
          </Stack>

          {bundle.header.tokenAmounts && (
            <Group gap="lg">
              {Object.entries(bundle.header.tokenAmounts).map(([sym, t]) => (
                <div key={sym}>
                  <Text size="xs" c="dimmed">
                    {sym} amount
                  </Text>
                  <Text ff="monospace" size="sm">
                    {fmtTokenUnits(t.tokenAmount, t.decimals)}
                  </Text>
                </div>
              ))}
            </Group>
          )}

          {bundle.header.swapPrerequisite && (
            <Alert variant="light" color="yellow" title="swap prerequisite">
              <Text size="sm">{bundle.header.swapPrerequisite}</Text>
            </Alert>
          )}

          <Group>
            <Tooltip
              label="Disabled: this demo does not broadcast. Mystic is Flare mainnet only."
              withArrow
            >
              <Button color="gray" disabled>
                Sign and send (disabled)
              </Button>
            </Tooltip>
            <Text size="xs" c="dimmed">
              No wallet is connected. Export the bundle and sign it in a
              reviewed environment against {addresses.network}.
            </Text>
          </Group>
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
      <Text ff="monospace" fw={600} size="sm">
        {value}
      </Text>
    </div>
  );
}
