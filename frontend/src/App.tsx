import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Menu,
  Stack,
  Stepper,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { addresses, isDeployed } from "@/addresses";
import {
  executePlan,
  readNav,
  readReserve,
  readVenues,
  type ExecuteResult,
  type VenueState,
} from "@/execute";
import { fetchCycle, fetchInputs, type BadKind, type Envelope, type ModelInputs } from "@/model";
import { Step1Inputs } from "@/components/Step1Inputs";
import { Step2Model } from "@/components/Step2Model";
import { Step3Plan } from "@/components/Step3Plan";
import { Step4Validation } from "@/components/Step4Validation";
import { Step5Execution } from "@/components/Step5Execution";
import { Step6Nav, type NavSnapshot } from "@/components/Step6Nav";

const BAD_KINDS: { value: BadKind; label: string }[] = [
  { value: "overcap", label: "over venue cap" },
  { value: "badsigner", label: "bad signer" },
  { value: "badfingerprint", label: "bad fingerprint" },
  { value: "replay", label: "replay" },
  { value: "expired", label: "expired" },
];

export function App() {
  const deployed = isDeployed();

  // step 1
  const [inputs, setInputs] = useState<ModelInputs>();
  const [inputsLoading, setInputsLoading] = useState(true);
  const [inputsError, setInputsError] = useState<string>();

  // steps 2-3
  const [envelope, setEnvelope] = useState<Envelope>();

  // step 4
  const [execResult, setExecResult] = useState<ExecuteResult>();
  const [ran, setRan] = useState(false);

  // steps 5-6
  const [venues, setVenues] = useState<VenueState[]>();
  const [reserve, setReserve] = useState<bigint>();
  const [navBefore, setNavBefore] = useState<NavSnapshot>();
  const [navAfter, setNavAfter] = useState<NavSnapshot>();

  const [busy, setBusy] = useState(false);

  const loadInputs = useCallback(async () => {
    setInputsLoading(true);
    setInputsError(undefined);
    try {
      setInputs(await fetchInputs());
    } catch (e) {
      setInputsError((e as Error).message ?? String(e));
    } finally {
      setInputsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInputs();
  }, [loadInputs]);

  const resetOnchain = () => {
    setExecResult(undefined);
    setRan(false);
    setVenues(undefined);
    setReserve(undefined);
    setNavBefore(undefined);
    setNavAfter(undefined);
  };

  const runCycle = useCallback(
    async (bad?: BadKind) => {
      setBusy(true);
      resetOnchain();
      try {
        // steps 1-3: always work against the model service
        await loadInputs();
        const env = await fetchCycle(bad);
        setEnvelope(env);

        if (!deployed) {
          notifications.show({
            color: "yellow",
            title: "contracts not deployed",
            message: "steps 1-3 shown; deploy to run on-chain steps 4-6",
          });
          return;
        }

        // snapshot NAV before submit (step 6 baseline)
        const before = await readNav();
        setNavBefore({ totalAssets: before.totalAssets, sharePrice: before.sharePrice });

        // step 4: submit
        const result = await executePlan(env);
        setExecResult(result);
        setRan(true);

        if (!result.ok) {
          notifications.show({
            color: "red",
            title: "plan REJECTED on-chain",
            message: result.revert
              ? `revert: "${result.revert}" (no funds moved)`
              : result.error ?? "reverted",
          });
          return;
        }

        // steps 5-6: read post-execution state
        const after = await readNav();
        setNavAfter({ totalAssets: after.totalAssets, sharePrice: after.sharePrice });
        setVenues(await readVenues(after.totalAssets));
        setReserve(await readReserve());

        notifications.show({
          color: "teal",
          title: "cycle executed",
          message: "all checks passed; allocations applied",
        });
      } catch (e) {
        notifications.show({
          color: "red",
          title: "cycle failed",
          message: (e as Error).message ?? String(e),
        });
      } finally {
        setBusy(false);
      }
    },
    [deployed, loadInputs],
  );

  const activeStep = ran ? (execResult?.ok ? 6 : 3) : envelope ? 3 : 1;
  const onchainOk = ran && execResult?.ok === true;

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={2}>Automated Curation</Title>
            <Text c="dimmed" size="sm">
              TEE-signed, bounded rebalancing on Flare (Coston2, chainId{" "}
              {addresses.chainId})
            </Text>
          </div>
          <Badge
            color={deployed ? "teal" : "yellow"}
            variant="light"
            size="lg"
          >
            {deployed ? "contracts deployed" : "not deployed"}
          </Badge>
        </Group>

        {!deployed && (
          <Alert color="yellow" title="Deploy the contracts first">
            addresses.json has no deployed contracts. Run{" "}
            <Text span ff="monospace">
              scripts/deploy.sh
            </Text>{" "}
            to enable on-chain steps 4-6. Steps 1-3 work against the model
            service now.
          </Alert>
        )}

        <Group>
          <Button loading={busy} onClick={() => void runCycle()}>
            Run cycle
          </Button>
          <Menu shadow="md" position="bottom-start">
            <Menu.Target>
              <Button variant="outline" color="red" disabled={busy}>
                Run bad plan
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>fetch /cycle?bad=&lt;kind&gt;</Menu.Label>
              {BAD_KINDS.map((k) => (
                <Menu.Item
                  key={k.value}
                  onClick={() => void runCycle(k.value)}
                >
                  {k.label}{" "}
                  <Text span c="dimmed" size="xs">
                    ({k.value})
                  </Text>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          {busy && <Loader size="sm" />}
        </Group>

        <Stepper active={activeStep} orientation="vertical" size="sm" iconSize={28}>
          <Stepper.Step
            label="Authenticated input"
            description="real FTSO read"
          >
            <></>
          </Stepper.Step>
          <Stepper.Step label="Sealed model run" description="fingerprint + attestation">
            <></>
          </Stepper.Step>
          <Stepper.Step label="Signed bounded plan" description="TEE signature">
            <></>
          </Stepper.Step>
          <Stepper.Step
            label="On-chain validation"
            description="8 ordered checks"
            color={ran && !execResult?.ok ? "red" : undefined}
          >
            <></>
          </Stepper.Step>
          <Stepper.Step label="Capped execution" description="amount vs cap">
            <></>
          </Stepper.Step>
          <Stepper.Step label="NAV after reconcile" description="delta">
            <></>
          </Stepper.Step>
        </Stepper>

        <Stack gap="md">
          <Step1Inputs
            inputs={inputs}
            loading={inputsLoading}
            error={inputsError}
          />
          <Step2Model envelope={envelope} />
          <Step3Plan envelope={envelope} />
          <Step4Validation result={execResult} ran={ran} />
          <Step5Execution venues={venues} reserve={reserve} active={onchainOk} />
          <Step6Nav before={navBefore} after={navAfter} active={onchainOk} />
        </Stack>

        <Center>
          <Text size="xs" c="dimmed">
            model: {import.meta.env.VITE_MODEL_URL ?? "http://127.0.0.1:8080"} |
            rpc: {addresses.rpcUrl}
          </Text>
        </Center>
      </Stack>
    </Container>
  );
}
