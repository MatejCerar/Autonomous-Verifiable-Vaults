// Self-measurement: codeHash = keccak256 of the model module bytes.
//
// In production this is the Confidential Space image_digest (sha256 of the
// container). Here it is an honest self-hash of the deterministic model module,
// so swapping in a real image digest later is a one-line change.
//
// We prefer the COMPILED model.js under dist/ if present (a built artifact),
// otherwise we hash the canonical source model.ts. Either way it is stable and
// deterministic for a given codebase.
import {existsSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {keccak256, toHex, type Hex} from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readModelBytes(): {bytes: Uint8Array; source: string} {
    // Built artifact first (matches "bytes of the compiled model module").
    const distPath = join(__dirname, "..", "dist", "model.js");
    if (existsSync(distPath)) {
        return {bytes: readFileSync(distPath), source: distPath};
    }
    // Canonical source fallback (tsx / dev run).
    const srcPath = join(__dirname, "model.ts");
    return {bytes: readFileSync(srcPath), source: srcPath};
}

export function computeCodeHash(): Hex {
    const {bytes} = readModelBytes();
    return keccak256(toHex(bytes));
}

export function measure(): {codeHash: Hex; source: string} {
    const {bytes, source} = readModelBytes();
    return {codeHash: keccak256(toHex(bytes)), source};
}

// CLI-invocable: print the codeHash so the deploy script can enable it.
if (
    process.argv[1] &&
    process.argv[1].endsWith("measure.ts")
) {
    const {codeHash, source} = measure();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({codeHash, source}, null, 2));
}
