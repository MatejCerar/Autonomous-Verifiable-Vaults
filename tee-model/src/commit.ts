// Input commitment. inputHash binds the plan to the authenticated inputs it saw.
// inputHash = keccak256(abi.encode(
//   flrValue, flrTimestamp, xrpValue, xrpTimestamp, venueStates, tvl, blockNumber))
// venueStates carry the authenticated Mystic snapshot per venue (utilisation,
// available liquidity, net supply APY, depeg).
import {encodeAbiParameters, keccak256, type Hex} from "viem";
import type {Inputs} from "./inputs.js";

export function computeInputHash(inputs: Inputs): Hex {
    const venueTuples = inputs.venues.map((v) => ({
        venueId: BigInt(v.venueId),
        utilisationBips: v.utilisationBips,
        availableLiquidity: v.availableLiquidity,
        supplyApyBips: v.supplyApyBips,
        depeg: v.depeg,
    }));

    return keccak256(
        encodeAbiParameters(
            [
                {name: "flrValue", type: "uint256"},
                {name: "flrTimestamp", type: "uint256"},
                {name: "xrpValue", type: "uint256"},
                {name: "xrpTimestamp", type: "uint256"},
                {
                    name: "venues",
                    type: "tuple[]",
                    components: [
                        {name: "venueId", type: "uint256"},
                        {name: "utilisationBips", type: "uint256"},
                        {name: "availableLiquidity", type: "uint256"},
                        {name: "supplyApyBips", type: "uint256"},
                        {name: "depeg", type: "bool"},
                    ],
                },
                {name: "tvl", type: "uint256"},
                {name: "blockNumber", type: "uint256"},
            ],
            [
                inputs.feed.value,
                inputs.feed.timestamp,
                inputs.xrpFeed.value,
                inputs.xrpFeed.timestamp,
                venueTuples,
                inputs.tvl,
                inputs.blockNumber,
            ]
        )
    );
}
