import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Center,
  Container,
  Group,
  Loader,
  NumberInput,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { Hex } from "viem";
import { addresses } from "@/addresses";
import { loadAll, type DemoData } from "@/data";
import { runCycle, type CycleResult } from "@/live";
import { Step1Inputs } from "@/components/Step1Inputs";
import { Step2Model } from "@/components/Step2Model";
import { Step3Plan } from "@/components/Step3Plan";
import { Step4Validation } from "@/components/Step4Validation";
import { Step5Execution } from "@/components/Step5Execution";

export function App() {
  // Static initial state (offline artifacts): shown before the first cycle.
  const [data, setData] = useState<DemoData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  // Live cycle state (drives Steps 1/2/3/5 once the button is clicked).
  const [cycle, setCycle] = useState<CycleResult>();
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleError, setCycleError] = useState<string>();
  const [capital, setCapital] = useState<number>(1_000_000);
  const [receiver, setReceiver] = useState<string>(
    "0x0000000000000000000000000000000000000001",
  );

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

  const startCycle = useCallback(async () => {
    setCycleLoading(true);
    setCycleError(undefined);
    try {
      const r = await runCycle({ capital, receiver: receiver as Hex });
      setCycle(r);
    } catch (e) {
      setCycleError((e as Error).message ?? String(e));
    } finally {
      setCycleLoading(false);
    }
  }, [capital, receiver]);

  // Prefer the live cycle output; fall back to the static artifacts.
  const market = cycle?.market ?? data?.market;
  const optimizer = cycle?.optimizer ?? data?.optimizer;
  const envelope = cycle?.envelope ?? data?.envelope;
  const bundle = cycle?.bundle ?? data?.bundle;

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
        </Group>

        <Card withBorder radius="md" padding="lg" bg="rgba(254,37,109,0.04)">
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
            <div>
              <Title order={4}>Run a live allocation cycle</Title>
              <Text size="sm" c="dimmed" maw={520}>
                Each click reads the live market on Flare mainnet (FTSO prices +
                vault state on-chain, APY/TVL from DefiLlama), runs the optimizer
                in your browser, and builds the prepared transactions. The
                numbers move because the inputs move. Nothing is broadcast.
              </Text>
            </div>
            <Group align="flex-end" gap="sm">
              <NumberInput
                label="capital (USD)"
                value={capital}
                onChange={(v) => setCapital(typeof v === "number" ? v : 1_000_000)}
                min={1000}
                step={100_000}
                thousandSeparator=","
                w={170}
                disabled={cycleLoading}
              />
              <Button
                size="md"
                color="pink"
                onClick={() => void startCycle()}
                loading={cycleLoading}
              >
                {cycle ? "Run cycle again" : "Start cycle"}
              </Button>
            </Group>
          </Group>

          <TextInput
            label="receiver (labeled placeholder)"
            value={receiver}
            onChange={(e) => setReceiver(e.currentTarget.value)}
            mt="sm"
            ff="monospace"
            size="xs"
            disabled={cycleLoading}
          />

          {cycleError && (
            <Alert color="red" title="Live cycle failed" mt="sm">
              {cycleError}. The initial view falls back to the offline snapshot.
            </Alert>
          )}

          {cycle && !cycleError && (
            <Text size="xs" c="dimmed" mt="sm" ff="monospace">
              last cycle at {new Date(cycle.at).toLocaleTimeString()}
            </Text>
          )}
        </Card>

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
            description="Flare mainnet, chainId 14"
          >
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
          <Step1Inputs
            market={market}
            loading={loading || cycleLoading}
            error={error}
            live={!!cycle}
          />
          <Step2Model optimizer={optimizer} live={!!cycle} />
          <Step3Plan envelope={envelope} live={!!cycle} />
          <Step4Validation envelope={envelope} />
          <Step5Execution bundle={bundle} live={!!cycle} />
        </Stack>

        <Center>
          <Text size="xs" c="dimmed">
            initial data: /data/*.json (offline artifacts). Live cycle: FTSO
            on-chain + DefiLlama, computed in-browser. protocol:{" "}
            {addresses.protocol}
          </Text>
        </Center>
      </Stack>
    </Container>
  );
}
