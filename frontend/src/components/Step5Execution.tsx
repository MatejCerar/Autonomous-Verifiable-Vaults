import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { PreparedBundle, PreparedTx } from "@/data";
import { addresses, explorerAddressUrl } from "@/addresses";
import { fmtTokenUnits, fmtUsd, truncateHex } from "@/format";

export interface Step5ExecutionProps {
  bundle?: PreparedBundle;
  live?: boolean;
}

function isApprove(tx: PreparedTx): boolean {
  return tx.decoded.fn.startsWith("approve");
}

export function Step5Execution({ bundle, live }: Step5ExecutionProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>5. Prepared transactions</Title>
        <Group gap="xs">
          {live && (
            <Badge variant="filled" color="pink">
              built this cycle
            </Badge>
          )}
          <Badge variant="light" color="orange">
            unsigned | chainId 14
          </Badge>
        </Group>
      </Group>


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
                <Group gap="xs" mt={4} align="flex-start" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={40}>
                    data
                  </Text>
                  <Code
                    fz="xs"
                    style={{
                      wordBreak: "break-all",
                      whiteSpace: "normal",
                      flex: 1,
                    }}
                  >
                    {tx.data}
                  </Code>
                  <CopyButton value={tx.data}>
                    {({ copied, copy }) => (
                      <Button
                        size="compact-xs"
                        variant="light"
                        color={copied ? "teal" : "gray"}
                        onClick={copy}
                      >
                        {copied ? "copied" : "copy"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
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

          <Text size="xs" c="dimmed">
            Sign these with your key to submit them on {addresses.network}.
          </Text>
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
