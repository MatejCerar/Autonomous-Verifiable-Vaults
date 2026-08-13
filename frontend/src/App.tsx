import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Center,
  Container,
  Group,
  Loader,
  Stack,
  Stepper,
  Text,
  Title,
} from "@mantine/core";
import { addresses } from "@/addresses";
import { loadAll, type DemoData } from "@/data";
import { Step1Inputs } from "@/components/Step1Inputs";
import { Step2Model } from "@/components/Step2Model";
import { Step3Plan } from "@/components/Step3Plan";
import { Step4Validation, type Scenario } from "@/components/Step4Validation";
import { Step5Execution } from "@/components/Step5Execution";
import { Step6Nav } from "@/components/Step6Nav";

export function App() {
  const [data, setData] = useState<DemoData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [scenario, setScenario] = useState<Scenario>("good");

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await loadAll());
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2}>Mystic Automated Allocation</Title>
            <Text c="dimmed" size="sm">
              TEE-signed, capped multi-token allocation into Mystic Finance on{" "}
              {addresses.network} (chainId {addresses.chainId})
            </Text>
          </div>
          <Badge color="orange" variant="light" size="lg">
            prepared, not broadcast
          </Badge>
        </Group>

        <Alert color="orange" title="This walkthrough is not executed on-chain">
          Mystic is Flare mainnet only, so this demo does not sign or broadcast.
          Steps 1-4 use live market data, the optimizer output and the TEE
          signature; step 5 shows the prepared (unsigned) transactions ready to
          sign later.
        </Alert>

        {error && (
          <Alert color="red" title="Failed to load demo data">
            {error}. Run{" "}
            <Text span ff="monospace">
              npm run sync-data
            </Text>{" "}
            to copy the artifacts into public/data.
          </Alert>
        )}

        <Stepper active={6} orientation="vertical" size="sm" iconSize={28}>
          <Stepper.Step label="Live market inputs" description="Mystic + FTSO">
            <></>
          </Stepper.Step>
          <Stepper.Step
            label="Optimizer in the TEE"
            description="risk-adjusted water-filling"
          >
            <></>
          </Stepper.Step>
          <Stepper.Step label="Signed bounded plan" description="TEE signature">
            <></>
          </Stepper.Step>
          <Stepper.Step
            label="Mandate validation"
            description="caps + signer enforced"
          >
            <></>
          </Stepper.Step>
          <Stepper.Step
            label="Prepared transactions"
            description="unsigned, chainId 14"
          >
            <></>
          </Stepper.Step>
          <Stepper.Step label="Summary" description="real vs simulated">
            <></>
          </Stepper.Step>
        </Stepper>

        {loading && !data && (
          <Center>
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                loading demo data...
              </Text>
            </Group>
          </Center>
        )}

        <Stack gap="md">
          <Step1Inputs market={data?.market} loading={loading} error={error} />
          <Step2Model optimizer={data?.optimizer} />
          <Step3Plan envelope={data?.envelope} />
          <Step4Validation
            envelope={data?.envelope}
            envelopeBad={data?.envelopeBad}
            envelopeBadSigner={data?.envelopeBadSigner}
            scenario={scenario}
            onScenario={setScenario}
          />
          <Step5Execution bundle={data?.bundle} />
          <Step6Nav data={data} />
        </Stack>

        <Center>
          <Text size="xs" c="dimmed">
            data: /data/*.json (synced from research, optimizer, tee-model,
            prepared-txs) | protocol: {addresses.protocol}
          </Text>
        </Center>
      </Stack>
    </Container>
  );
}
