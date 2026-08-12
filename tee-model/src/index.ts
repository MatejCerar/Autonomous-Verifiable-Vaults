// CLI + HTTP entry for the simulated TEE model service.
//
//   run                 print a VALID envelope to stdout and write ./last-plan.json
//   run --bad=<kind>    print an intentionally invalid envelope
//   selftest            exercise the real preimage+sign+recover path (no deploy needed)
//   serve               tiny HTTP server: GET /cycle, /cycle?bad=<kind>, /inputs, /health
import {writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {getAddress} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {
    getRpcUrl,
    getTeePrivateKey,
    loadAddresses,
    loadEnv,
} from "./config.js";
import {makeClient, readInputs} from "./inputs.js";
import {computeInputHash} from "./commit.js";
import {measure} from "./measure.js";
import {
    buildContext,
    runCycle,
    type CycleContext,
    type Envelope,
} from "./envelope.js";
import {buildBadEnvelope, isBadKind, BAD_KINDS, type BadKind} from "./badplan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAST_PLAN_PATH = join(__dirname, "..", "last-plan.json");

function now(): bigint {
    return BigInt(Math.floor(Date.now() / 1000));
}

function jsonBig(obj: unknown): string {
    return JSON.stringify(
        obj,
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2
    );
}

interface Env {
    ctx: CycleContext;
    client: ReturnType<typeof makeClient>;
}

function setup(): Env {
    loadEnv();
    const addresses = loadAddresses();
    const account = privateKeyToAccount(getTeePrivateKey());
    const client = makeClient(getRpcUrl(addresses));
    const ctx = buildContext(account, addresses);

    // If addresses.json already carries a teeSignerAddress, warn on mismatch.
    if (
        addresses.teeSignerAddress &&
        addresses.teeSignerAddress !== "" &&
        getAddress(addresses.teeSignerAddress) !== getAddress(account.address)
    ) {
        process.stderr.write(
            `WARNING: env TEE key address ${account.address} != addresses.json ` +
                `teeSignerAddress ${addresses.teeSignerAddress}\n`
        );
    }
    return {ctx, client};
}

async function cmdRun(bad?: BadKind): Promise<void> {
    const {ctx, client} = setup();
    let envelope: Envelope;
    if (bad) {
        envelope = await buildBadEnvelope(client, ctx, bad, now());
    } else {
        const result = await runCycle(client, ctx, now());
        if (!result.recoverOk) {
            throw new Error(
                "self-check failed: recovered signer != TEE account"
            );
        }
        envelope = result.envelope;
    }
    const out = jsonBig(envelope);
    writeFileSync(LAST_PLAN_PATH, out + "\n");
    process.stdout.write(out + "\n");
}

async function cmdSelftest(): Promise<void> {
    const {ctx, client} = setup();
    const m = measure();
    process.stderr.write(`teeSigner:  ${getAddress(ctx.account.address)}\n`);
    process.stderr.write(`codeHash:   ${m.codeHash}\n`);
    process.stderr.write(`measured:   ${m.source}\n`);
    process.stderr.write(`controller: ${ctx.controller}\n`);
    process.stderr.write(`chainId:    ${ctx.chainId}\n`);

    const result = await runCycle(client, ctx, now());
    process.stderr.write(
        `chainConnected:   ${result.inputs.chainConnected}\n`
    );
    process.stderr.write(
        `contractsDeployed:${result.inputs.contractsDeployed}\n`
    );
    process.stderr.write(
        `oracleFallback:   ${result.inputs.feed.oracleFallback}\n`
    );
    process.stderr.write(
        `FLR/USD value:    ${result.inputs.feed.value} (dec ${result.inputs.feed.decimals}, ts ${result.inputs.feed.timestamp})\n`
    );
    process.stderr.write(`planHash:   ${result.planHash}\n`);
    process.stderr.write(`recovered:  ${result.signed.recovered}\n`);
    process.stderr.write(
        `recover == teeSigner: ${result.recoverOk ? "PASS" : "FAIL"}\n`
    );

    const teeMatchesFile =
        !ctx.addresses.teeSignerAddress ||
        ctx.addresses.teeSignerAddress === "" ||
        getAddress(ctx.addresses.teeSignerAddress) ===
            getAddress(ctx.account.address);
    process.stderr.write(
        `recover == addresses.teeSignerAddress: ${
            ctx.addresses.teeSignerAddress
                ? teeMatchesFile
                    ? "PASS"
                    : "FAIL"
                : "N/A (not deployed yet)"
        }\n`
    );

    if (!result.recoverOk) {
        process.exitCode = 1;
        return;
    }
    process.stderr.write("SELFTEST PASS\n");
}

// ---- HTTP server ----

function send(res: ServerResponse, code: number, body: unknown): void {
    const payload = jsonBig(body);
    res.writeHead(code, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
    });
    res.end(payload + "\n");
}

async function handle(
    env: Env,
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
        });
        res.end();
        return;
    }

    if (url.pathname === "/health") {
        send(res, 200, {
            ok: true,
            teeSigner: getAddress(env.ctx.account.address),
            codeHash: env.ctx.codeHash,
        });
        return;
    }

    if (url.pathname === "/inputs") {
        const inputs = await readInputs(env.client, env.ctx.addresses);
        const inputHash = computeInputHash(inputs);
        send(res, 200, {
            feed: {
                id: env.ctx.addresses.flrUsdFeedId,
                value: inputs.feed.value.toString(),
                decimals: inputs.feed.decimals,
                timestamp: inputs.feed.timestamp.toString(),
                oracleFallback: inputs.feed.oracleFallback,
            },
            tvl: inputs.tvl.toString(),
            venues: inputs.venues.map((v) => ({
                venueId: v.venueId,
                address: v.address,
                utilisationBips: v.utilisationBips.toString(),
                availableLiquidity: v.availableLiquidity.toString(),
                depeg: v.depeg,
                reachable: v.reachable,
            })),
            blockNumber: inputs.blockNumber.toString(),
            chainConnected: inputs.chainConnected,
            contractsDeployed: inputs.contractsDeployed,
            inputHash,
        });
        return;
    }

    if (url.pathname === "/cycle") {
        const badParam = url.searchParams.get("bad");
        try {
            if (badParam !== null) {
                if (!isBadKind(badParam)) {
                    send(res, 400, {
                        error: `unknown bad kind '${badParam}'`,
                        kinds: BAD_KINDS,
                    });
                    return;
                }
                const envelope = await buildBadEnvelope(
                    env.client,
                    env.ctx,
                    badParam,
                    now()
                );
                send(res, 200, envelope);
                return;
            }
            const result = await runCycle(env.client, env.ctx, now());
            if (!result.recoverOk) {
                send(res, 500, {error: "self-check failed: recover mismatch"});
                return;
            }
            send(res, 200, result.envelope);
        } catch (e) {
            send(res, 500, {error: String(e)});
        }
        return;
    }

    send(res, 404, {error: "not found", routes: ["/cycle", "/inputs", "/health"]});
}

function cmdServe(): void {
    const env = setup();
    const port = Number(process.env.PORT ?? 8080);
    const server = createServer((req, res) => {
        handle(env, req, res).catch((e) => send(res, 500, {error: String(e)}));
    });
    server.listen(port, () => {
        process.stderr.write(
            `tee-model serving on http://127.0.0.1:${port}\n` +
                `  teeSigner=${getAddress(env.ctx.account.address)}\n` +
                `  codeHash=${env.ctx.codeHash}\n` +
                `  routes: GET /cycle  /cycle?bad=<kind>  /inputs  /health\n`
        );
    });
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const cmd = args[0] ?? "run";
    const badArg = args.find((a) => a.startsWith("--bad="));
    const badKind = badArg ? badArg.slice("--bad=".length) : undefined;

    if (cmd === "serve") {
        cmdServe();
        return;
    }
    if (cmd === "selftest") {
        await cmdSelftest();
        return;
    }
    if (cmd === "measure") {
        // Print only the model codeHash (fingerprint) for the deploy script.
        process.stdout.write(measure().codeHash + "\n");
        return;
    }
    if (cmd === "run") {
        if (badKind !== undefined) {
            if (!isBadKind(badKind)) {
                process.stderr.write(
                    `unknown bad kind '${badKind}'. kinds: ${BAD_KINDS.join(", ")}\n`
                );
                process.exitCode = 2;
                return;
            }
            await cmdRun(badKind);
            return;
        }
        await cmdRun();
        return;
    }
    process.stderr.write(
        `usage: index.ts <run|serve|selftest> [--bad=<${BAD_KINDS.join("|")}>]\n`
    );
    process.exitCode = 2;
}

main().catch((e) => {
    process.stderr.write(`fatal: ${String(e)}\n`);
    process.exitCode = 1;
});
