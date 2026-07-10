# serve-sim fixtures

`bun run sim:serve` exposes a booted Apple Simulator on loopback only. For a
camera fixture, run:

```bash
bun run sim:camera -- --file scripts/serve-sim/fixtures/<fixture>.png
```

Tracked fixtures belong in `fixtures/`. Each image must have a plaintext
payload sidecar and an entry in `manifest.json` containing its stable id, both
paths, both SHA-256 digests (`imageSha256` and `payloadSha256`), expected
classifier result, and `"payable": false`. The manifest contract is enforced by
`__tests__/serveSimManifest.test.ts`.

Only deterministic, non-payable inputs may be committed. Never commit a valid
Cashu bearer token or proof, live Lightning invoice, mnemonic, nsec/private
key, or production wallet/mint data. Generate live payment QRs per run under
`.device-artifacts/serve-sim/<run-id>/`, reconcile their funds, then delete the
run directory.

Keep the preview bound to `127.0.0.1`; do not expose its control surface on a
LAN or unauthenticated tunnel. Stop injected camera state with
`bun run sim:camera:stop` after a run.
