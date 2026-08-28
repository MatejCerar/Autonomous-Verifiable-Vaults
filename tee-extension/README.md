# tee-extension: the AVV CURATION/CYCLE FCC extension

Ready-to-deploy source for running the AVV allocation model as a real Flare
Confidential Compute (FCC) TEE extension on Coston2. An engineer copies these
files into a fresh `fce-extension-scaffold` clone, deploys, and returns two
values that plug into the `demo-with-tee` frontend.

The enclave runs the AVV optimizer over a market snapshot and returns an
enclave-signed `PlanLib.Plan` (3 venues + reserve). The frontend calls
`sendCuration(bytes)` and decodes that Plan, so the allocation is verifiable
rather than computed in the browser.

## What is in this folder

| Path | What it is |
| --- | --- |
| `extension/config.ts` | Adds `OP_TYPE_CURATION` / `OP_COMMAND_CYCLE` (bytes32 of "CURATION"/"CYCLE") next to the Hello World constants. |
| `extension/avv.ts` | `PLAN_ABI` (PlanLib.Plan tuple), `buildPlan(marketData, params)`, `encodePlan(plan)`. |
| `extension/handlers.ts` | Adds `handleCurationCycle` + registers CURATION/CYCLE + `reportCurationState()`; leaves `reportState()` untouched. |
| `extension/vendor/optimize.ts` | Verbatim AVV optimizer (pure TS, no network). |
| `extension/vendor/marketData.ts` | Bundled market snapshot, typed export (used when the message is empty "0x"). |
| `extension/__tests__/curation.test.ts` | Unit tests: status 1, caps, reserve floor, totals identity, deterministic planId, empty-message fallback. |
| `InstructionSender.sol` | Scaffold contract with the added `sendCuration(bytes)` + the two op constants. Replaces `contracts/InstructionSender.sol`. |
| `env/.env.coston2.example` | `.env.coston2` template (secrets blanked). |
| `env/extension_proxy.coston2.docker.toml.example` | Proxy config with `[db]` indexer placeholders. |
| `probe.mjs` | Direct CURATION/CYCLE prober: POSTs an Action to the extension server and prints the decoded Plan. |
| `DEPLOY.md` | The full runbook (prereqs, copy-in, env, tunnel, setup, probe, gotchas). |

The `extension/config.ts` and `extension/handlers.ts` here are FULL files (Hello
World code plus the AVV additions), so copying them over the scaffold's versions
is correct.

## How it relates to the frontend (demo-with-tee)

The frontend's real-TEE path (`../src/tee.ts`) calls `sendCuration` on the
deployed `InstructionSender`, derives the `instructionId` from the
`TeeInstructionsSent` event, polls the ext-proxy for the result, and decodes the
`PlanLib.Plan`. The op-type/op-command bytes32 pinned in `../src/tee.config.ts`
(`CURATION_OPTYPE` / `CURATION_OPCOMMAND`) MUST equal the constants this
extension registers against, which they do:

```
CURATION = 0x4355524154494f4e000000000000000000000000000000000000000000000000
CYCLE    = 0x4359434c45000000000000000000000000000000000000000000000000000000
```

## The two values that go back into the frontend

After a successful deploy, paste into `../src/tee.config.ts`:

| Frontend field | Source |
| --- | --- |
| `INSTRUCTION_SENDER` | The deployed `InstructionSender` address on Coston2. |
| `EXT_PROXY_URL` | The public ext-proxy URL (cloudflared `https://<slug>.trycloudflare.com`, no trailing slash). |

See `DEPLOY.md` for the step-by-step.
