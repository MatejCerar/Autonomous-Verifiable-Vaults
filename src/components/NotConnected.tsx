// CONFIG-EMPTY STATE: a clean centered card shown when the TEE / display vault
// is not configured. Does not break the page.
// No emojis, no em dashes (house style).
import { Card, Center, List, Stack, Text, Title } from "@mantine/core";

export function NotConnected() {
  return (
    <Center mih="70vh">
      <Card withBorder radius="lg" padding="xl" shadow="sm" maw={520}>
        <Stack gap="md">
          <div>
            <Title order={3}>No vault connected</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Deploy the TEE stack, then fill the addresses in{" "}
              <Text span ff="monospace">
                src/tee.config.ts
              </Text>{" "}
              to connect the dashboard.
            </Text>
          </div>
          <List size="sm" spacing="xs" c="dimmed">
            <List.Item>
              <Text span ff="monospace">
                INSTRUCTION_SENDER
              </Text>{" "}
              - the on-chain instruction entry point on Coston2
            </List.Item>
            <List.Item>
              <Text span ff="monospace">
                EXT_PROXY_URL
              </Text>{" "}
              - the ext-proxy that serves the enclave result
            </List.Item>
            <List.Item>
              <Text span ff="monospace">
                ALLOCATION_DISPLAY
              </Text>{" "}
              - the display vault the cycle is written to
            </List.Item>
          </List>
        </Stack>
      </Card>
    </Center>
  );
}
