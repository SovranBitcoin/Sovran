# 19. An exact send needs no mint, so an offline send never asks for one

Date: 2026-09-28
Status: Accepted; native verification outstanding.

Amended by [ADR 0020](0020-retry-access-without-replacing-custody.md): exact bearer
sends now use the local path immediately, including while online.

Amends [ADR 0017](0017-the-wallet-core-ships-unmodified.md): the wallet core
carries one patch, named here. Everything else in 0017 stands.

## Context

Sending ecash in airplane mode failed on 0.1.3.

When the proofs in the wallet add up to the amount exactly, the token is those
proofs. Nothing is asked of the mint. Coco 2.0.0 still refreshes mint info and
keysets before preparing any send, whenever its stored copy is older than five
minutes, and throws `MintFetchError` when the refresh fails. Executing an
exact-match send refreshed again. So an offline send worked only within five
minutes of the last refresh, and never after a cold start without a network,
though the keysets it needed were stored.

Coco has always done this, and upstream `master` (2026-09-23) still refreshes
in `prepare`, although it now executes exact-match sends locally. Sovran
regressed. From 2026-04-10 its coco patch returned stored data when the refresh
failed; commit `64587846` (2026-05-27) deleted that patch file whole. Tags
0.1.0 and 0.1.3 shipped without it.

A second regression landed in `88fad974` (2026-05-20). When held proofs
matched the amount exactly, the send machine created the token locally even
while online, skipping coco's online path.

Coco's mint requests have no timeout. In airplane mode a request fails at once;
against a mint that is down while the internet is up, it waits for the
operating system to give up.

The reference wallets agree on the shape. cdk's `SendKind::OfflineExact` loads
keysets cache-only and fails when no exact selection exists; its online sends
fall back to stored keysets. nutshell's `cashu send --offline` requires an
exact selection. cashu.me keeps going with stored keysets when a refresh
fails.

## Decision

**Coco** takes an explicit `offline` option on `ops.send.prepare`, like cdk,
instead of falling back silently. With it, prepare builds its wallet from the
stored mint and keysets, contacts nothing, and succeeds only for an exact
match; otherwise it throws `ProofValidationError` before reserving anything.
It is refused for P2PK sends, which always swap. Executing an exact-match
operation no longer refreshes mint data, as on upstream `master`. Without the
option coco behaves as published: stale data is refreshed, and an unreachable
mint fails prepare before anything is reserved.

The change is written in coco's TypeScript against `v2.0.0` with coco unit
tests, kept in `app/patches/sources/`, and compiled into
`app/patches/@cashu+coco-core+2.0.0.patch` by
`app/patches/sources/build-coco-offline-send.sh`. See
[README.coco-offline-send.md](../../patches/README.coco-offline-send.md).

**The app** routes a send by what it knows:

| Situation | Path |
| --- | --- |
| Online | `executeSend`: coco's ordinary prepare, which refreshes and picks an exact match or a swap. |
| Online, and coco reports the mint unreachable | Exact amount: `executeOfflineSend`. Otherwise the round-down / round-up sheet. The flow is marked `mintUnreachableConfirmed` and stays local. |
| Offline (`OfflineProvider` or the mock toggle), or proofs picked from the sheet | Exact amount: `executeOfflineSend` directly, with no network request. Otherwise the sheet. |

`executeOfflineSend` prepares with `offline: true`. `isMintOfflineError` now
also recognises `KeysetSyncError` and a network failure carried as an error's
`cause`.

## Consequences

An exact-match send works offline whatever the age of the stored mint data,
including after a cold start with no network.

An online exact-match send refreshes mint data first, as coco intends. If the
mint is down while the internet is up, the user waits for the request to fail
before the local token is made.

The amount screen's promise and coco agree. A property test runs random proof
sets and amounts through `buildProofSuggestions` and the patched coco; every
amount the screen calls exact, coco sends offline, and no other.

A pending offline send cannot be taken back until the mint is reachable;
reclaiming is a swap. Cancelling a prepared send still refreshes mint data;
the offline path refuses before preparing, so it never needs to.

## Removal

Remove the patch when a published coco prepares a send from stored mint data
without a network request. The app's routing stays.

## Evidence and limits

- `wallet/__tests__/integration/offline-send-stale-mint.test.ts` runs the
  installed bundle with in-memory repositories and a `fetch` that always
  fails. Before the patch, the stale-data send failed with `MintFetchError`.
  With it, the exact send contacts nothing, a non-exact one is refused with
  nothing reserved, the online path still reports an unreachable mint, and the
  property test above holds.
- Coco's unit suite, with the new tests, passes on the source commit.
- The send-machine tests pin the routing table above.

Nothing here was run on a device. The airplane-mode send on a phone, offline
receive, and the five-second offline confirmation in `OfflineProvider` are
unverified.

## Amendment (2026-09-29): offline-first mint data

The patch now follows cdk further. A failed refresh of stale mint data falls
back to the stored info and keysets instead of throwing, so an online
exact-match send to an unreachable mint is made locally without an error.
`Manager.setOffline`, driven by `OfflineProvider` in the Colada provider, skips
the refresh altogether. A send that needs a swap still requires the mint: it
checks reachability before reserving anything and fails with `MintFetchError`,
which the app already routes to the round-down / round-up sheet. Exact
matches are found by a subset search, so coco sends every amount the amount
screen calls exact. The same change is on coco branch
`feat/offline-first-mint-metadata` for upstream.
