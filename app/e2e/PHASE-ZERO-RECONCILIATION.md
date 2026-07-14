# Phase Zero — fund reconciliation record (redacted)

Immutable record of the fund-safety gate run before any destructive test action.
No mnemonics, tokens, invoices, or proofs are stored here — only safe metadata.

## Ledger inspected

- File: `app/e2e-screenshots/SEEDS.json` (gitignored, append-only, 2 entries)
- Both entries: `flow=lightning-receive`, `mint=mint.sovran.money`, `accountIndex=0`,
  ledger flag `swept=yes`, `sweptSats=68`.

## Independent re-verification (not trusting the flag)

- Reason: `sweep.ts sweepOne` marks a seed swept when `recovered > 0` **even if
  another mint's probe threw** (recovered-branch wins over the logged `probeError`).
  So a `swept` flag alone does not prove every default mint was reachable and empty.
- Tool: `verify-residual.ts` — app-faithful derivation
  (`deriveCashuSeed`: master → HDKey `m/44'/129372'/0'/<acct>'/0/0` →
  `entropyToMnemonic` → `mnemonicToSeedSync`), then cashu-ts
  `restore`/`batchRestore`/`checkProofsStates` per mint. 25s per-mint timeout so an
  unreachable mint reports UNRESOLVED rather than a false zero. Recovers nothing.
- Probed each seed against `mint.sovran.money`, `mint.minibits.cash/Bitcoin`,
  `mint.chorus.community`, `mint.cubabitcoin.org`.

## Verdict: RECONCILED

- Both seeds: **0 sats UNSPENT at every mint, all four mints reachable.** No residual,
  no unresolved leg. No quarantine required.

## Actions taken

- Stopped orphaned seed-export Metro (pid 82644 on :8082, had
  `EXPO_PUBLIC_E2E_SEED_EXPORT` set). User's normal dev Metro (:8081) left running.
- "Sovran Screenshots" simulator preserved (no erase/reinstall).

## Later read-only audit caveat (2026-07-12)

- The process above was stopped at Phase Zero, but a later orphan `expo start
--port 8082` process (pid 79187) was live and its `app/e2e/artifacts/metro.log`
  was still changing during the final audit. It was not stopped or otherwise
  mutated in this slice. The startup audit therefore continues to report the
  legacy seed-export record set as an unresolved blocker.

## Environment (cocod determinism finding)

- `which -a cocod` → `~/.bun/bin/cocod` (0.0.16) shadows `/opt/homebrew/bin/cocod`
  (0.0.14). PATH default resolves to 0.0.16. The new harness must pin an explicit
  `COCOD_BIN` + record path/version in preflight (see architecture decision).
