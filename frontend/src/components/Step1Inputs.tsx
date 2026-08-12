import { Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import type { ModelInputs } from "@/model";
import { fmtFeed, fmtTimestamp } from "@/format";

export interface Step1InputsProps {
  inputs?: ModelInputs;
  loading: boolean;
  error?: string;
}

export function Step1Inputs({ inputs, loading, error }: Step1InputsProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={4}>1. Authenticated input</Title>
        <Badge variant="light" color="gray">
          real FTSO read (Coston2)
        </Badge>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {loading && !inputs && (
        <Text c="dimmed" size="sm">
          reading FLR/USD from the model service...
        </Text>
      )}

      {inputs && (
        <Stack gap="xs">
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed">
                FLR / USD
              </Text>
              <Text size="xl" fw={600} ff="monospace">
                {fmtFeed(inputs.flrUsdValue, inputs.flrUsdDecimals)}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                decimals
              </Text>
              <Text ff="monospace">{inputs.flrUsdDecimals ?? "-"}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                timestamp
              </Text>
              <Text ff="monospace" size="sm">
                {fmtTimestamp(inputs.flrUsdTimestamp)}
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <Badge color={inputs.fresh ? "teal" : "yellow"} variant="filled">
              {inputs.fresh ? "fresh" : "stale"}
            </Badge>
            <Badge color={inputs.depeg ? "red" : "teal"} variant="light">
              {inputs.depeg ? "depeg" : "peg ok"}
            </Badge>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
