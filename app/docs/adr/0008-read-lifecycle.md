# 8. One read lifecycle: status vocabulary, cache-first paint, sequential vs aggregate tiers

Date: 2026-09-13
Status: Accepted (builds on ADR 0003's facade; closes convention-audit follow-ups F01 and F06)

## Context

Every social and mint surface fetched its own way, and the user-visible result
was twitchy loading: tabs blanked to spinners with the data already cached,
search rows vanished while typing, profile headers nulled on navigation, counts
rendered "0" when they were simply unknown, and a nagg outage looked identical
to "no results". Nothing emitted a consistent fetch-lifecycle event and the
facade's tier events carried no correlation id, so none of this was measurable
from a log.

The facade (ADR 0003) resolved every read sequentially: nagg → Primal → relays,
first answer wins. That is right for ordered lists (merging two rankings
reshuffles rows) and wrong for gap-fillable data (profiles, counts, search hits,
reviews), where a slower tier can complete what a faster one missed.

## Decision

### Status vocabulary and paint policy

Every hook and screen reports `loading | revalidating | ready | empty | error`
plus `partial` and `source`. Cached data always paints synchronously; a refetch
is background work that never blanks what is on screen. A key change shows that
key's cached entry or a skeleton, never `null` plus a spinner. Skeletons are data
items rendered by the same row component (FlashList surfaces) or a
`SkeletonContentCrossfade` with the same component in both branches. Unknown
counts render a placeholder or a dash, never a zero.

### One consumer over the query cache

`createQueryCacheStore.run` has a per-key generation and a store-wide scope
generation; a completion that is no longer current never writes (F01).
`useCachedRead` is the one React consumer: `data` is the store selector, so
persistence, LRU, scope and cold-start policy stay in the store. `seed` paints a
value from a prior step as `revalidating`; `keepPreviousData` opts a same-surface
refinement (a search query) into holding the previous rows; `classify` maps zero
items to `empty` and an unavailable read to `error`. The DM paging engine keeps
its own loop (cursor + client-side decrypt) but speaks the same status vocabulary.

### Empty is not unavailable

Feed, thread and notification results carry `read: ReadStatusMeta`
(`ok | unavailable | disabled` with the tier attempt trail). Screens derive:
unavailable with nothing retained → error with Retry; unavailable with retained
rows → keep them, show degraded; ok with zero items → the empty state (F06).

### Two tier engines, chosen by the shape of the data

| Shape | Engine | Surfaces |
|---|---|---|
| Ordered list — the first answering tier *is* the page | sequential (`resolveAcrossTiers`) | feed, thread, followers, DM envelopes, search posts, mint discovery, mint changes, mint detail, mint audit |
| Gap-fillable — later answers add or refine, never reorder | aggregate (`resolveAllTiers`) | profiles `{requested, 800ms}`, profile stats `{1, 1000ms}`, search profiles `{3, 600ms}`, mint reviews `{1, 800ms}`, social graph |
| Per-item counts that may land one at a time | each | note stats |
| Merged multi-source stream | session (400ms gate) | notifications |

The aggregate engine opens every candidate tier at once, resolves at `minItems`
or `capMs` — never while nothing has answered — and delivers later merges
through `onUpdate` or the entity cache. Merges are idempotent, append-only and
rank-aware: a better tier's fields replace a worse tier's in place; a worse tier
can only add. The gate table is `app/shared/lib/read/readPolicy.ts`.

### Correlation and measurement

Every read carries a `readId` (`RequestControls.readId`, minted by the facade
when absent) stamped on `read.<surface>.*`, `query_cache.run.*`,
`nostr.read.*` and `nostr.tier.*` events. Keys travel as `keyHash`. log-doctor's
`reads` mode reports per-surface cache-hit rate, unnecessary refetches
(`RefetchFresh`), time-to-first-usable-data, superseded writes and blank
flashes. The acceptance bar for any loading change is zero `RefetchFresh` and
zero blank flashes on the touched surface.

## Consequences

- Surfaces migrated: search (people, mints, posts), notifications + followers,
  profile header + profile feed + note stats, contacts (DM list) + DM thread,
  mint detail + reviews + audit + changes. Each has a Retry action on the
  rowless error state (`*-retry` test ids) so a nagg outage is recoverable.
- Aggregate fan-out costs a request per extra tier on small kind-0 / kind-3 /
  38000 / search reads only; feeds and threads stay single-tier. Relay note-stat
  counting runs only for ids still absent after page ingest.
- DM snapshots (`dm-conversations-cache`, `dm-thread-cache`) are memory-only and
  viewer-keyed; no plaintext is persisted (hunch rule nostr/private-dms).
- Hand-rolled SWR loops that remain (`relayMetadataStore`,
  `mintMetadataStore.getCachedMintInfo`, `nostrMetadataCache`,
  `mempoolAddressCache`) are candidates for the same hook when touched.
