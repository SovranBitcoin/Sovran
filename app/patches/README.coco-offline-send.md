# Coco offline exact send patch

`ops.send.prepare` in Coco `master` (58abfae) refreshes mint data once the
stored copy is older than five minutes and throws `MintFetchError` when the
mint is unreachable. Sending proofs the wallet already holds creates no
outputs and needs nothing from the mint, so without this patch an exact send
fails after five minutes offline, and always after a cold start offline.

With the patch, `ops.send.prepare({ mintUrl, amount, offline: true })` selects
and reserves stored proofs in one transaction with no mint request, no active
keyset and no seed. It refuses with `OfflineSendError` before reserving
anything when no exact selection exists (`no_exact_match`) or when combined
with a send target, `forceSwap` or `coverReceiverFees` (`unsupported_option`).
Nothing persisted changes: the prepared operation is the same as any other
exact one. Why the app needs it: [ADR 0019](../docs/adr/0019-an-exact-send-needs-no-mint.md).

Selection takes the largest proof that still fits. For power-of-two
denominations that finds an exact sum whenever one exists; for other
denominations it can miss one and the send is refused.

## Source

[`sources/coco-core/0001-offline-exact-send.patch`](sources/coco-core/0001-offline-exact-send.patch)
is the change as a commit on Coco `master` 58abfae, with its unit tests, docs
and changeset. It is [cashubtc/coco#533](https://github.com/cashubtc/coco/pull/533)
(open, unreviewed on 2026-11-28) rebased without conflict. Review that file,
not the bundle diff.

## Rebuild

1. In a Coco checkout at the pinned commit, `git am` every file in
   `sources/coco-core/` in order, `bun install`, then in `packages/core` run
   `bun run test:unit` and `bun run build`.
2. An unmodified build of the pinned commit reproduces the published `dist/`
   byte for byte. Rename the patched build's content-hashed chunks to the
   published names and rewrite the references to them.
3. `bun patch @cashu/coco-core`, copy the patched `dist/` in,
   `bun patch --commit node_modules/@cashu/coco-core --patches-dir app/patches`.

Built on 2026-11-28 with 2,512 Coco unit tests passing.
`wallet/__tests__/integration/offline-send-stale-mint.test.ts` runs the app's
send against the installed bundle with a dead network, and
`app/__tests__/cocoCoreUnmodified.test.ts` checks the patch reaches no further.
