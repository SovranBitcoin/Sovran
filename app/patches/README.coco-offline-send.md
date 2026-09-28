# Coco offline exact-match send patch

`@cashu+coco-core+2.0.0.patch` adds `offline` to `ops.send.prepare`. With it,
coco prepares a send from the mint's stored keysets without contacting the
mint, and succeeds only when held proofs add up to the amount exactly.
Otherwise it fails before reserving anything. Executing an exact-match send
also stops refreshing mint data, since it hands over proofs the wallet already
holds. Without `offline`, coco behaves as published: stale mint data (older
than five minutes) is refreshed, and a mint that cannot be reached fails the
prepare with `MintFetchError` before anything is reserved.

Why, and how the app uses it: [ADR 0019](../docs/adr/0019-an-exact-send-needs-no-mint.md).

## Source

The patch is compiled from the source diff kept here as
[`sources/coco-core-2.0.0-offline-send.patch`](sources/coco-core-2.0.0-offline-send.patch).
Review that file, not the bundle diff. It holds the TypeScript change, its
unit tests and a changeset, based on tag `v2.0.0` (`7dada830`). The original
offline patch was `dfb590f4`; the 2026-09-28 regression review added a deterministic
greedy pass for binary proof denominations after reproducing a randomized selector
miss at 1097 sats. The online selector remains unchanged:

| Where | Change |
| --- | --- |
| `MintService.getStoredMint` | The Known Mint's stored info and keysets, however old. Reads two repositories. |
| `WalletService.getOfflineWallet` | A Wallet Instance built from stored data. Not cached, so online callers still refresh. |
| `WalletService.createWallet` | Wallet construction extracted from `buildWallet` so both share it. |
| `ProofService.selectProofsToSend` | Optional `wallet` argument; the send handlers pass the one prepare was given. |
| `SendOperationService.prepare` | `options.offline` selects the offline wallet; refuses non-default methods. |
| `SendOperationService.execute` | An exact-match operation uses the offline wallet. |
| `DefaultSendHandler.prepare` | Offline binary exact selection is deterministic; non-exact sends fail before reservation. |
| `SendOpsApi.prepare` | `PrepareSendInput.offline`, passed through. |

The design follows cdk, whose `SendKind::OfflineExact` loads keysets with a
cache-only policy and returns an error when no exact selection exists
(`crates/cdk/src/wallet/send/mod.rs`, `send/saga/mod.rs`). nutshell's
`cashu send --offline` also requires an exact selection.

## Rebuild

```sh
app/patches/sources/build-coco-offline-send.sh ../../coco
```

The script applies the source diff to coco `v2.0.0` in a temporary worktree,
runs coco's unit tests, builds, restores the published names of the
content-hashed type chunks, and regenerates the bun patch from the published
package. A `v2.0.0` build reproduces the published `dist/` byte for byte, so
the bun patch holds only what the source diff compiles to. Rebuilt on 2026-09-28 with 1,252 Coco unit tests passing. The installed-bundle
integration test also pins the selector counterexample with `Math.random = 0`.
`app/__tests__/cocoCoreUnmodified.test.ts` checks which files the patch
touches.

## Remove when

A published coco lets a send be prepared from stored mint data without a
network request. Upstream `master` (2026-09-23) already executes exact-match
sends locally but still refreshes in `prepare`
(`SendOperationService.prepare` → `refreshAndCommitIfStale`).
