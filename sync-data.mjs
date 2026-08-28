// Copies the data artifacts produced by the other demo workers into
// frontend/public/data so the app can fetch them from /data/*.json at runtime
// (works under both `vite dev` and `vite build`). Wired into predev/prebuild.
//
// No emojis, no em dashes in this file (house style).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(here, "public", "data");

// source path (relative to repo root) -> destination file name
const MAP = [
  ["research/market-data.json", "market-data.json"],
  ["optimizer/result.json", "result.json"],
  ["tee-model/sample-envelope.json", "envelope.json"],
  ["prepared-txs/bundle.json", "prepared-bundle.json"],
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
let missing = 0;
for (const [src, dst] of MAP) {
  const from = resolve(root, src);
  const to = resolve(outDir, dst);
  if (!existsSync(from)) {
    console.warn(`[sync-data] MISSING ${src} (skipped)`);
    missing++;
    continue;
  }
  copyFileSync(from, to);
  console.log(`[sync-data] ${src} -> public/data/${dst}`);
  copied++;
}

console.log(`[sync-data] done: ${copied} copied, ${missing} missing`);
if (missing > 0) {
  console.warn(
    "[sync-data] some artifacts were missing; run the upstream workers first",
  );
}
