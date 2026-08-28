# onchain - AllocationDisplay (Coston2 display vault)

Minimal, zero-dependency Foundry project for the AVV TEE demo's on-chain
"display vault". It stores the LATEST enclave-signed best position and a
monotonic cycle counter, and emits an event per push. Only the demo relayer
(`updater`, set once in the constructor) may write; reads are open.

`AllocationDisplay.sol` has no dependencies. `forge-std` is used only by the
test and the deploy script, so a fresh checkout needs it installed once.

## Build + test

```
export PATH="$HOME/.nix-profile/bin:$PATH"   # nix foundry + nodejs_22
forge install foundry-rs/forge-std --no-git  # only the test/script need this
forge build
forge test -vv
```

## Deploy (Coston2)

`DeployAllocationDisplay.s.sol` deploys with `updater = msg.sender`, so the
key you sign with becomes the relayer that is allowed to `pushCycle`. Use the
same throwaway demo signer the frontend uses (`DEMO_SIGNER_KEY`).

```
forge script script/DeployAllocationDisplay.s.sol:DeployAllocationDisplay \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  --private-key $DEMO_SIGNER_KEY --broadcast
```

Copy the printed address into `src/tee.config.ts` as `ALLOCATION_DISPLAY`.

## Interface

```
function pushCycle(bytes32 planId, uint256 totalOut, uint256 reserveAmount, uint256[3] amounts) external returns (uint256 cycleId);  // onlyUpdater
function latest() external view returns (Cycle);   // (planId,totalOut,reserveAmount,uint256[3] amounts,uint64 timestamp,uint256 cycleId)
function cycleCount() external view returns (uint256);
event CyclePushed(uint256 indexed cycleId, bytes32 indexed planId, uint256 totalOut, uint256 reserveAmount, uint256[3] amounts, uint64 timestamp);
```

Venue order in `amounts` is canonical: `[0]=FXRP, [1]=USDT0, [2]=WFLR`. All USD
amounts are 1e18 fixed point.
