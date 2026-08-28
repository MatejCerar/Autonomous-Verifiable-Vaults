# Run the enclave endpoint on a server (Docker)

This gives the frontend a durable enclave URL. It runs `enclave-service.mjs` (the
model + TEE signing, the same code the Flare enclave handler runs) plus a
cloudflared tunnel for HTTPS. Only Docker is required on the server.

## Steps

On the server:

```
git clone https://github.com/MatejCerar/Autonomous-Verifiable-Vaults.git
cd Autonomous-Verifiable-Vaults/tee-extension
docker compose -f docker-compose.enclave.yml up -d
docker compose -f docker-compose.enclave.yml logs tunnel | grep trycloudflare
```

Copy the printed `https://<slug>.trycloudflare.com` URL and set it as `GATEWAY_URL`
in `src/tee.config.ts`, then rebuild the frontend.

## Verify

```
curl -s -X POST https://<slug>.trycloudflare.com/curation -H 'content-type: application/json' -d '{"nonce":"0"}'
# -> {"status":1,"data":"0x...","log":"ok"}   (a 672-byte Plan + signature)
```

## Config

The service ships with the deployed Coston2 values baked in (teeAddress signer,
CurationController, chain 114, model fingerprint). Override with env if you
redeploy the contracts: `TEE_PLAN_SIGNER_KEY`, `AVV_CONTROLLER`, `AVV_CHAIN_ID`,
`AVV_CODE_HASH`, `AVV_MODEL_VERSION`.

## Notes

- The signer key baked in is a testnet throwaway (its address is the registered
  `MandateRegistry.teeAddress`). Anyone who can call the endpoint can request a
  signed plan; on-chain the mandate caps still bound it. Fine for a testnet demo.
- Attestation is simulated (same as the demo throughout). The hardware-attested
  version is the GCP Confidential Space path.
- For a permanent URL (survives container recreation) use a named cloudflared
  tunnel instead of the quick tunnel.
