# Alternative route: AVV-wrapped execution (executePlan)

The `bundle.json` transactions are the DIRECT route: the curator approves and
deposits into each Mystic Core vault by hand. This is simple and auditable but it
bypasses the Automated Curation Vault (AVV) enforcement stack.

The AVV route instead deposits capital into the enforcement vault once, then lets
the on-chain `CurationController` route funds into the same three Mystic Core
vaults through the `MysticVenueAdapter`s, but only if the TEE-signed plan passes
the 8 mandate checks (replay, nonce, expiry, fingerprint, signer, caps, total
out, reserve floor). This is the "trust-minimized" path the demo is really about.

## Two steps

### Step 1: fund the enforcement vault (book asset = USDT0)

Per `DeployMystic.s.sol`, the AVV `AutomatedCurationVault` is initialized with
`bookAsset = USDT0`. Depositing capital is a standard ERC-4626 pair on the vault
(NOT on a Mystic Core vault):

- approve USDT0 -> AutomatedCurationVault, amount = capital in USDT0 base units.
- `deposit(assets, receiver)` on AutomatedCurationVault.

The AVV vault address is produced at deploy time (`out.vault` in
`DeployMystic.s.sol`); it is not fixed here. Fill it in from the deployment
output before broadcast.

### Step 2: executePlan(signedPlan)

The controller entry point (from `contracts/src/CurationController.sol`):

```solidity
function executePlan(PlanLib.Plan calldata plan, bytes calldata signature) external;
```

`PlanLib.Plan` (see `tee-model/src/sign.ts`, matches the on-chain struct):

```
struct Plan {
    bytes32  planId;
    uint256  modelVersion;
    bytes32  codeHash;
    uint256  nonce;
    uint256  expiry;
    uint256  totalOut;
    uint256  reserveAmount;
    Allocation[] allocations;   // { uint256 venueId; uint256 amount; }
}
```

The `plan` + `signature` come from the TEE-model signed envelope
(`tee-model` -> `runCycle` -> `Envelope`). The envelope's `plan` object and
`signature` map one-to-one onto the `executePlan` arguments:

- `plan.allocations` = `[{venueId:0, amount: FXRP_base_units}, {venueId:1, amount:
  USDT0_base_units}, {venueId:2, amount: WFLR_base_units}]`
- `plan.totalOut` = sum of allocation amounts (in book-asset accounting units)
- `plan.reserveAmount` = reserve kept in the ReserveAdapter
- `signature` = the TEE EIP-191 signature over `PlanLib.hashPlan(controller,
  chainId, plan)`

## executePlan calldata (TEMPLATE - not final)

The signed envelope is not finalized in this worker's inputs, so the calldata
below is a TEMPLATE. Once the tee-model emits the final envelope, encode with:

```js
import {encodeFunctionData, parseAbi} from "viem";
const abi = parseAbi([
  "function executePlan((bytes32 planId,uint256 modelVersion,bytes32 codeHash,uint256 nonce,uint256 expiry,uint256 totalOut,uint256 reserveAmount,(uint256 venueId,uint256 amount)[] allocations) plan, bytes signature)"
]);
const data = encodeFunctionData({
  abi,
  functionName: "executePlan",
  args: [
    {
      planId:       envelope.plan.planId,
      modelVersion: BigInt(envelope.plan.modelVersion),
      codeHash:     envelope.plan.codeHash,
      nonce:        BigInt(envelope.plan.nonce),
      expiry:       BigInt(envelope.plan.expiry),
      totalOut:     BigInt(envelope.plan.totalOut),
      reserveAmount:BigInt(envelope.plan.reserveAmount),
      allocations:  envelope.plan.allocations.map(a => ({
                       venueId: BigInt(a.venueId), amount: BigInt(a.amount) })),
    },
    envelope.signature,
  ],
});
// tx: { to: CurationController, value: "0x0", data }
```

- `to` = the deployed `CurationController` (`out.controller` from `DeployMystic.s.sol`).
- selector = first 4 bytes of `keccak256("executePlan((bytes32,uint256,bytes32,uint256,uint256,uint256,uint256,(uint256,uint256)[]),bytes)")`.
- The plan is single-use (planId replay-guarded) and expires (`expiry`), so it
  must be freshly produced by the TEE and broadcast within its validity window.

## Why the direct route is what we ship in bundle.json

For a "prepare, do not execute" mainnet demo, the direct approve+deposit bundle
is fully self-contained and verifiable from static inputs. The AVV route depends
on (a) the deployed AVV/controller addresses and (b) a live, freshly TEE-signed
plan whose nonce matches the on-chain controller nonce and whose expiry is in the
future. Those are runtime artifacts, so this route is documented as a template
rather than baked into `bundle.json`.
