// HEADER: product title, a "Coston2 - TEE-verified" pill, the vault address as a
// monospace chip linking to the Coston2 explorer, and the connection/config
// status.
// No emojis, no em dashes (house style).
import { Anchor, Badge, Group, Stack, Text, Title } from "@mantine/core";
import { ALLOCATION_DISPLAY, explorerAddress } from "@/tee.config";
import { shortHex } from "./vault";

export function Header({
  teeReady,
  displayReady,
}: {
  teeReady: boolean;
  displayReady: boolean;
}) {
  const statusColor = teeReady ? "teal" : displayReady ? "blue" : "gray";
  const statusLabel = teeReady
    ? "Live TEE"
    : displayReady
      ? "Local mode - ready"
      : "Not configured";
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
      <div>
        <Title order={2}>Automated Verifiable Vault</Title>
        <Text c="dimmed" size="sm" mt={2}>
          Allocation computed and signed in a Flare TEE, verified and enforced
          on-chain by CurationController (Coston2).
        </Text>
      </div>

      <Stack gap={6} align="flex-end">
        <Group gap="xs">
          <Badge color="flare" variant="light" radius="sm" size="lg">
            Coston2
          </Badge>
          <Badge color={statusColor} variant="light" radius="sm" size="lg">
            {statusLabel}
          </Badge>
        </Group>
        {displayReady && ALLOCATION_DISPLAY && (
          <Anchor
            href={explorerAddress(ALLOCATION_DISPLAY)}
            target="_blank"
            rel="noreferrer"
            ff="monospace"
            size="xs"
            c="dimmed"
          >
            vault {shortHex(ALLOCATION_DISPLAY, 8, 6)}
          </Anchor>
        )}
      </Stack>
    </Group>
  );
}
