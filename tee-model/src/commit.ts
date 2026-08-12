// Input commitment. inputHash binds the plan to the authenticated inputs it saw.
// inputHash = keccak256(abi.encode(feedValue, feedTimestamp, venueStates, tvl, blockNumber))
import {encodeAbiParameters, keccak256, type Hex} from "viem";
import type {Inputs} from "./inputs.js";

export function computeInputHash(inputs: Inputs): Hex {
    const venueTuples = inputs.venues.map((v) => ({
        venueId: BigInt(v.venueId),
        utilisationBips: v.utilisationBips,
        availableLiquidity: v.availableLiquidity,
        depeg: v.depeg,
    }));

    return keccak256(
        encodeAbiParameters(
            [
                {name: "feedValue", type: "uint256"},
                {name: "feedTimestamp", type: "uint256"},
                {
                    name: "venues",
                    type: "tuple[]",
                    components: [
                        {name: "venueId", type: "uint256"},
                        {name: "utilisationBips", type: "uint256"},
                        {name: "availableLiquidity", type: "uint256"},
                        {name: "depeg", type: "bool"},
                    ],
                },
                {name: "tvl", type: "uint256"},
                {name: "blockNumber", type: "uint256"},
            ],
            [
                inputs.feed.value,
                inputs.feed.timestamp,
                venueTuples,
                inputs.tvl,
                inputs.blockNumber,
            ]
        )
    );
}
