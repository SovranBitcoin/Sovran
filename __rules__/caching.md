# Caching — the rules

Cache the **fetch**, not the structured derived data. A fetch wrapper has one
shape and many call sites. Structured data has many shapes and is built
from one (or several) fetches. Caching downstream forces every screen to
re-derive — and to re-fire the upstream fetch when nothing else has cached
it.

## When to add a cache

Add one when **all three** are true:

1. The data crosses a network or disk boundary (HTTP, relay, SQLite, CCipher).
2. ≥2 callers will read the same key, OR the same caller reads it on every
   render / mount.
3. The data is stable enough that staleness is acceptable for at least one
   render frame (use SWR — never block on freshness).

If only (1) is true, you have a one-shot read. Don't cache.

## Where to add it

The cache lives at the **single fetch wrapper** that everyone calls.

- ✅ One module exports `getCachedX(fetcher, key)` and the store. Every caller
  imports that helper.
- ✅ Coco / NDK / API events that mutate the underlying source feed the cache
  through a small subscription (see `attachMintInfoCacheToManager`).
- ❌ A Zustand store of `{audit, score, info, profile}` per mint (the
  enrichment store), populated by 4 separate effects scattered across
  components. That's caching at the structured-data end. The fetches still
  fire from every screen that needs raw `info`.

## The shape

Match the existing pattern. Every cache in this app does the same thing:

| Concern              | Pattern                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage              | Zustand `persist` + `persistConfig({...})` from `shared/lib/persist/persistConfig.ts`                                                                                                                   |
| AsyncStorage adapter | bare `AsyncStorage` for **host-scoped** data (mint info, audit), `createProfileScopedStorage()` for **user-scoped** data (kind-0 metadata, NIP-04 plaintext)                                            |
| Schema               | Zod `looseObject` over the persisted shape. Treat opaque blobs as `z.unknown()` and re-cast on read — don't try to validate vendor wire shapes                                                          |
| Read API             | sync `getCachedX(key)` → `T \| undefined`, hook `useCachedX(key)` for React                                                                                                                             |
| Fetch API            | async `getCachedX(fetcher, key)` returning `Promise<T>` with SWR semantics: cached fresh resolves immediately, cached stale resolves with the prior value + kicks off a background refetch, miss awaits |
| Concurrency          | module-level `Map<string, Promise<T>>` for in-flight dedupe                                                                                                                                             |
| Eviction             | LRU at `MAX_ENTRIES * 0.9`, oldest by `fetchedAt` first                                                                                                                                                 |
| TTL                  | 24h is the default for "stable wire data" (mint info, kind-0 metadata). Shorter only when the source itself rotates often                                                                               |

## Native module profile scope

Native modules must not use a single `UserDefaults`, keychain, SQLite, or
in-memory singleton namespace for user-scoped chat/payment data. Pass the
active profile pubkey (or a stable hash of it) across the JS/native boundary
and include it in every native storage key and identity seed.

- **Profile-scoped:** DM threads, retry state, peer/contact history, private
  message cursors, and transport identities that affect which messages are
  accepted or advertised.
- **Host-scoped:** public catalog data, static relay lists, cache metadata
  that is independent of the logged-in profile.
- If a native singleton stays alive across a React account-scope remount,
  its `start(..., profileScope)` entrypoint must detect scope changes and
  recreate the profile-owned native service before accepting new events.

## Examples in the codebase

- **Mint NUT-06 info** — `shared/stores/global/mintInfoCache.ts`. Sits above
  coco's 5-minute internal TTL. Subscribed to `mint:added` / `mint:updated`
  in `CocoProvider` so DB refreshes flow into the cache.
- **Nostr kind-0 profile metadata** — `shared/stores/global/nostrMetadataCache.ts`.
  Profile-scoped (one cache per logged-in identity). Used by
  `useNostrProfileMetadata` / `useNostrProfileMetadataMany`.
- **NIP-04 DM plaintext** — `shared/lib/nostr/nip04Cache.ts`. Profile-scoped.
  Built on `createPubkeyScopedCache` because it has a negative-cache for
  known-failed decrypts.
- **NIP-17 gift-wrap unwraps** — `shared/lib/nostr/giftWrapCache.ts`.
  Hydrated at NDK init so `useRecentContacts` reads synchronously on
  first render.
- **BitChat BLE DM state** — `features/bitchat/stores/bitchatDmMessages.ts`
  uses `createProfileScopedStorage()`, while `BitChatBLEBridge` and
  `BitChatNostrBridge` receive the active profile scope before reading native
  DM history or deriving transport identity keys.

## What's already cached — don't re-cache

- **NDK relay events**: `NDKCacheAdapterSqlite` is wired in
  `shared/providers/NostrNDKProvider.tsx`. Don't add a second event cache.
  If profiles still feel slow, look at _when_ the subscription is created
  (after render = wait for at least one cache round-trip) or whether the
  consumer is blocking on a peer fetch (e.g. `getMintInfo`).
- **Coco mint DB**: `manager.mint.getAllTrustedMints()` reads from coco's
  persistent SQLite — already cache-like at the DB layer. The HTTP refresh
  is what blocks; that's what `mintInfoCache` covers.

## What NOT to cache

- One-shot migrations (`shared/lib/cashu/migration.ts` keeps a direct
  `manager.mint.getMintInfo` because it deliberately wants fresh data).
- Anything that's already a `useState`-derived computation. Memoize
  (`useMemo`) at the consumer instead.
- Per-render derived UI state. That's `useMemo`'s job.

## Anti-patterns

- **Caching at the consumer** — a screen-local `useState<MintInfo>` that's
  populated by an effect. Every screen builds its own cache, none shares,
  fetches re-fire on every navigation.
- **Caching the enrichment, not the source** — see "Where to add it"
  above. The enrichment stores (`auditMintStore`, `kymMintStore`,
  `mintProfileStore`) are fine for what they hold (audit + score + Nostr
  profile lookup), but the underlying NUT-06 info is its own cache and
  doesn't go in any of those.
- **No SWR** — blocking on revalidation defeats the cache. Always return
  the cached value first when one exists.
- **Schema-strict persisted shape** — vendor wire shapes change between
  versions. Validate the envelope (`fetchedAt: number`, `info: unknown`)
  and let the consumer re-fetch on shape mismatch.
