// FOOTER: an honest note about the TEE + attestation, plus the ext-proxy and
// InstructionSender addresses as small monospace links.
// No emojis, no em dashes (house style).
import { Anchor, Divider, Group, Stack, Text } from "@mantine/core";
import {
  EXT_PROXY_URL,
  INSTRUCTION_SENDER,
  explorerAddress,
} from "@/tee.config";
import { shortHex } from "./vault";

export function Footer() {
  return (
    <Stack gap="xs" mt="xl">
      <Divider />
      <Text c="dimmed" size="xs" maw={640}>
        Allocation computed inside a Flare Confidential Compute TEE and recorded
        on-chain. Hardware attestation is simulated on Coston2.
      </Text>
      <Group gap="lg">
        {INSTRUCTION_SENDER && (
          <Text c="dimmed" size="xs" ff="monospace">
            InstructionSender{" "}
            <Anchor
              href={explorerAddress(INSTRUCTION_SENDER)}
              target="_blank"
              rel="noreferrer"
            >
              {shortHex(INSTRUCTION_SENDER)}
            </Anchor>
          </Text>
        )}
        {EXT_PROXY_URL && (
          <Text c="dimmed" size="xs" ff="monospace">
            ext-proxy{" "}
            <Anchor href={EXT_PROXY_URL} target="_blank" rel="noreferrer">
              {String(EXT_PROXY_URL).replace(/^https?:\/\//, "")}
            </Anchor>
          </Text>
        )}
      </Group>
    </Stack>
  );
}
