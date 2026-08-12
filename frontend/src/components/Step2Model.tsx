import { Alert, Badge, Card, Code, Group, Stack, Text, Title } from "@mantine/core";
import type { Envelope } from "@/model";
import { truncateHex } from "@/format";

export interface Step2ModelProps {
  envelope?: Envelope;
}

export function Step2Model({ envelope }: Step2ModelProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>2. Sealed model run</Title>
        <Badge
          variant="light"
          color="grape"
          leftSection={<span aria-hidden>lock</span>}
        >
          sealed
        </Badge>
      </Group>

      {!envelope && (
        <Text c="dimmed" size="sm">
          run a cycle to seal a model output
        </Text>
      )}

      {envelope && (
        <Stack gap="sm">
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed">
                modelVersion
              </Text>
              <Text ff="monospace">{envelope.plan.modelVersion}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                codeHash (fingerprint)
              </Text>
              <Code>{truncateHex(envelope.plan.codeHash)}</Code>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                inputHash
              </Text>
              <Code>{truncateHex(envelope.inputHash)}</Code>
            </div>
          </Group>

          <Alert variant="light" color="yellow" title="attestation: SIMULATED for PoC">
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
