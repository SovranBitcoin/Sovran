# Pass 2 survey: feed, social features and the Nostr package

Area: `app/features/{feed,composer,contacts,user}`, `nostr/src/**`, and the app glue that syncs own events, relay
lists, follows and gift wraps (`app/shared/lib/nostr/{ownsync,outbox}`, `buildNostrDataLayer.ts`,
`useEntityCache.ts`, `fetchProfiles.ts`, `moderation.ts`, `giftWrapCache.ts`, and the profile-scoped
`nostrSocialStore` that the follow button writes). Paths are from the checkout root
(`/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery`, branch `surgery/pass-2`).

Method: started from pass 0's `feed-social.md` and `nostr.md` candidate lists, read every file named below, grepped
`docs/follow-ups/` before calling anything a defect. One trace was run (`bun -e` against the real
`nostr/src/facade/session/notifications-session.ts` with a fake source; no file written); everything else is
"traced" (read end to end), not run. No test suite was run.

Already filed and not repeated here (cited where they touch a candidate): F122, F125, F153, F185, the capability-cache item (since deleted), F203,
F204, F02, F47.

Shapes the repo already uses that a conversion should reuse, not reinvent:

- `app/shared/lib/read/useCachedRead.ts`: `ReadStatus = 'loading' | 'revalidating' | 'ready' | 'empty' | 'error'`
  with a flight record, generation and cache. `UserFeed`, `useNotificationsPage`, contacts search and mint screens
  use it. `HomeFeed` and `useThread` do not.
- `nostr/src/facade/feed-pager.ts:13`: `FeedLaneState = 'ready' | 'backoff' | 'exhausted' | 'unsupported'`.
- `app/shared/lib/nostr/useEntityCache.ts`: `ProfileStatus` union derived at the hook boundary.
- `wallet/src/machine` (transition table plus effects) for anything with timers, retries and cancellation.
- `app/features/feed/lib/engagementToggle.ts`: an explicit intent-convergence loop (`reconcileToggle`), the model the
  follow button lacks.

---

## Ranking

| # | Candidate | Reachable illegal state | Risk | Size | Recommendation |
|---|---|---|---|---|---|
| 1 | Own contact list: provenance of `followingPubkeys` vs `contactsTags` | yes, traced | public follow list overwritten (wire) | S-M | convert |
| 2 | Follow button intent (`optimisticFollowsByPubkey` + `followInFlight`) | yes, traced, persisted | button locked for a person for good | S | convert |
| 3 | Own relay list (`entries`/`source`/`hasPublished`/`updatedAt`) and its two publishers | yes, traced | saved data + public kind 10002 | M | convert |
| 4 | Own-events sync ownership and newness (`useOwnEventsSync`) | yes, traced and pinned | cross-account saved data (setting-gated) | S | convert |
| 5 | Notifications session per-source state | yes, run | pagination ends after one failure | S | convert |
| 6 | `HomeFeed` loader | yes, traced (one pinned) | none saved; feed stuck/stale | M | convert |
| 7 | `useThread` load phase | yes, traced | none saved; wrong empty/error state | M | convert |
| 8 | Feed page cursor (`paginationUntil`/`Offset`/`Cursor`/`hasMore`) and the second cursor in the facade pager | yes, traced | none saved | M | convert after 6 |
| 9 | Profile resolution status (`profiles`/`pendingProfiles`/`settledProfiles`) | yes, traced | memory only | S | convert |
| 10 | Composer session and the two post flows | yes, pinned | none saved; F204 wire question | S-M | convert (small) |
| 11 | Block state (`ignoredPubkeys`/`muteList`/`blockOverrides`) | narrow | persisted, public kind 10000 | M | defer |
| 12 | Feed pager lanes (`nostr/src/facade/feed-pager.ts`) | no | memory | S | leave |
| 13 | Like/repost/zap overlays (`useNostrEngagement`, `nostrSocialStore` optimistic maps) | no new | persisted overlays | - | leave |
| 14 | Image overlay open/close phase | possible, harmless | none | L | defer |
| 15 | Capability cache (`nostr/src/capabilities.ts`) | yes (the capability-cache item (since deleted)) | none, no caller | S | delete (the capability-cache item (since deleted)) |

---

## 1. Own contact list: which source owns the follow list

**Files.** `app/shared/stores/profile/nostrSocialStore.ts:87-91` (state), `:425-447` (`setContactsFromRelay`),
`:449-470` (`seedFollowsFromFacade`), `:739-743` (`selectIsFollowingPubkey`);
`app/shared/lib/nostr/ownsync/useOwnSocialGraphSeed.ts:24-66`; `app/shared/lib/nostr/ownsync/useOwnEventsSync.ts:46-91`
(the one-year `since` and the 5,000 cap on one filter covering every kind), `:127-134`;
`app/features/user/screens/UserProfileScreen.tsx:176-199` (`buildUpdatedContactTags`), `:1042-1109`
(`toggleFollowContacts`), `:1155-1162`.

**Variables.** `contactsTags`, `contactsContent`, `contactsUpdatedAt`, `followingPubkeys`. `followingPubkeys` is a
derived value stored beside its source: `setContactsFromRelay` derives it from `contactsTags`; `seedFollowsFromFacade`
writes it from a parsed facade list and bumps `contactsUpdatedAt`, but leaves `contactsTags` alone by design (comment
at `:121-129`).

**States.**
- `unknown`: no list from anywhere (`contactsUpdatedAt === 0`, tags empty).
- `readOnlySeed(at)`: `followingPubkeys` from the facade; `contactsTags` empty or older than `at`.
- `authoritative(at)`: `contactsTags` is the kind 3 at `at`, `followingPubkeys` derived from it.

Events: facade seed (`useOwnSocialGraphSeed`), relay kind 3 (`useOwnEventsSync`), own follow publish
(`toggleFollowContacts` → `setContactsFromRelay`).

**Meaningless combinations.** `contactsUpdatedAt = T` with `contactsTags` from before `T` (or empty) while
`followingPubkeys` lists the newer follows. The store cannot say whether `contactsTags` is the list at
`contactsUpdatedAt`.

**Reachable today (traced).** Fresh install or import of an existing account whose kind 3 is more than a year old (or
outside the newest 5,000 own events across kinds 0/1/3/5/6/7): `useOwnSocialGraphSeed` seeds the follows from nagg or
Primal; the relay subscription's `since = now - 1 year` (pinned as a QUIRK in
`app/__tests__/useOwnEventsSync.test.tsx:126`) never returns the kind 3, so `contactsTags` stays `[]` while the
profile shows "Following" for everyone the person follows. Tapping Follow on any profile runs
`buildUpdatedContactTags([] , target, true)` and publishes a kind 3 holding one `p` tag
(`UserProfileScreen.tsx:1081-1099`), replacing the person's whole follow list on every write relay; then
`setContactsFromRelay` shrinks `followingPubkeys` to one. The same race exists for any account in the seconds before
the relay kind 3 arrives. See defect D1.

**Persisted.** Yes: `nostr-social-store` (profile scope, version 2), fields `contactsTags`, `contactsContent`,
`contactsUpdatedAt`, `followingPubkeys`. A conversion can keep the shape: add an optional `contactsTagsAt` (defaulted,
no version bump) or decide `authoritative` at the read boundary as "`followingPubkeys` equals the set derived from
`contactsTags`".

**Consumers.** 9 files read these fields: `UserProfileScreen.tsx`, `HomeFeed.tsx`, `feedEmptyStates.ts`,
`DrawerProfileChrome.tsx`, `FollowBadge.tsx`, `SignerApprovalSheetContent.tsx`, `fetchProfiles.ts`,
`useOwnSocialGraphSeed.ts`, the store. Only `toggleFollowContacts` writes a kind 3.

**Pins today.** `app/__tests__/ownSyncLifecycle.test.tsx` (seed once, last-writer gate, equal timestamps keep the
current list), `useOwnEventsSync.test.tsx` (one-year `since` QUIRK), `nostrSocialStoreMigrate.test.ts`,
`persistRoundTrip`, `releasedWriterBounds`, release fixtures. **Nothing pins `toggleFollowContacts`.** Pin first: a
follow with authoritative tags publishes old tags plus the new one; a follow with only a facade seed (current
behaviour, QUIRK) publishes one tag; failure clears the overlay and shows the popup.

**Recommendation: convert.** A discriminated `ContactListState` decoded at the store's read boundary
(`unknown | seeded | authoritative`), and the follow writer accepts only `authoritative`, otherwise reads the kind 3
first (the "read before replace" that `setPersonBlocked` already does for kind 10000 in
`app/shared/lib/nostr/moderation.ts:178-196`). Separately, split the own-events filter so kinds 0 and 3 carry no
`since` (that changes a subscription, not a stored shape).

**Deletes.** The comment-enforced rule in `seedFollowsFromFacade`/`setContactsFromRelay` (`<` versus `<=`), and the
need for every reader to know `contactsTags` may lag. Size S-M (store, one screen, one hook).

## 2. Follow button intent

**Files.** `nostrSocialStore.ts:108`, `:360-364`, `:404` (persisted schema), `:474-507` (`setFollowOptimistic`,
`clearFollowOptimistic`, `clearSettledFollowOptimistic`), `:739-743`; `UserProfileScreen.tsx:1075-1108`, `:1288-1289`
(`followInFlight = !!entry?.pending`), `:1348-1365` (`useSingleFlight` because `followInFlight` lags a render).

**Variables.** `optimisticFollowsByPubkey[pk] = { value, pending, updatedAt }`, `followingPubkeys[pk]`, the
`useSingleFlight` guard.

**States.** `idle(following)`, `publishing(intent)`, `failed`. Events: tap, publish ok, publish err, relay kind 3
arrives, app killed.

**Meaningless combinations.** `pending: true` with no publish running (after a kill); `pending: false, value` equal to
the confirmed state (cleared only when a kind 3 arrives).

**Reachable today (traced).** Tap Follow, kill the app before `publishEvent` settles (all-settled across write relays
can take seconds). On restart the persisted entry is `{ value, pending: true }`: `selectIsFollowingPubkey` shows the
intent as fact, `followInFlight` is true so `toggleFollowContacts` returns early at `:1075`, and
`clearSettledFollowOptimistic` keeps every `pending` entry (`:495`). Nothing resumes or clears it (unlike likes and
reposts, which `settleOverlays` resumes in `useNostrEngagement.ts:254-261`). The release fixture already holds such an
entry (`app/__tests__/releaseUpgrade.test.ts:179`). See defect D2.

**Persisted.** `nostr-social-store.optimisticFollowsByPubkey`. Keep the shape; decode `pending: true` at rehydrate as
"interrupted", then either resume through a reconcile loop or drop it.

**Consumers.** `UserProfileScreen.tsx`, `FollowBadge.tsx` (through the selector), the store.

**Pins.** Store shape only (`persistRoundTrip`, `releaseUpgrade`). No behaviour pin. Pin first: tap → pending →
publish ok clears; err clears and popups; a rehydrated pending entry (QUIRK: locks the button).

**Recommendation: convert.** Reuse `reconcileToggle` (`app/features/feed/lib/engagementToggle.ts`) for follows: the
overlay holds the intent, one loop converges it, a rehydrated pending entry resumes. Deletes `followInFlight`, the
`useSingleFlight` workaround and the early return. Size S.

## 3. Own relay list and its two publishers

**Files.** `app/shared/lib/nostr/outbox/relayListStore.ts:20-30`, `:106-139`, `:160-164`;
`app/shared/lib/nostr/outbox/useOwnRelayListSync.ts:32-73`;
`app/features/settings/screens/SettingsNetworkScreen.tsx:54-80` (`publishRelayList`), `:98-110`, `:171`
(`hasUnpublished = source === 'local'`), `:187-190`, `:322-328`, `:379-401`;
`app/features/feed/hooks/useDeletePost.ts:89-90` (reads `entries` with its own fallback).

**Variables.** `entries`, `updatedAt`, `hasPublished`, `source: 'default' | 'relay' | 'local'`, the sentinel
`entries: []` meaning "use `DEFAULT_RELAYS`" (`getOwnWriteRelays`), plus the screen's `publishing` and `publishMsg`.

**States.** `implicitDefaults` (nothing known), `synced(at)`, `dirty` (local edits, unpublished), `publishing(snapshot)`,
`firstRunPublished(at)`.

**Meaningless combinations reachable today.**
- `source: 'relay', hasPublished: true, entries: []`: after the first-run publish `markPublished` sets
  `source: 'relay'` without writing the defaults into `entries` (`useOwnRelayListSync.ts:64-66`). On the next start the
  fetched list has the same `created_at`, so `setFromRelay` ignores it (`relayListStore.ts:108`) and `entries` stays
  `[]` for good. Network settings shows an empty list; adding one relay makes it the only write relay (the defaults
  the account published are no longer in `entries`). Traced.
- `source: 'relay'` while `entries` holds an edit that was never published: an edit made while "Publish relay list" is
  in flight is marked published (defect D3). Traced.
- `source: 'local'` replaced by any older network list (F203 item 1, pinned in `useOwnRelayListSync.test.tsx:155`).

**Persisted.** `nostr-relay-list-store` (profile scope): `entries`, `updatedAt`, `hasPublished`, `source` (already
`.catch('default')`). Keep the shape; decode into a union at read; add an optional `publishedSnapshot` hash or
`dirtySince` if needed (adding is allowed).

**Consumers.** 12 files read the store or `getOwnWriteRelays` (composer, delete, mute sync, moderation, Settings,
relay sync, publishers).

**Pins.** `app/__tests__/useOwnRelayListSync.test.tsx` (read, ingest, first-run publish, failure, unmount, account
change), `persistRoundTrip`, `persistedEnumTolerance`, `releasedWriterBounds` (64-relay cap). **Settings publish is
unpinned.** Pin first: publish success marks published; an edit during publish (QUIRK); empty `entries` after first-run
publish (QUIRK).

**Recommendation: convert.** A reducer in the store (`implicitDefaults | synced | dirty | publishing`) with one
publish function shared by the first-run path and Settings, and `markPublished(created, publishedEntries)` that only
returns to `synced` when the entries still equal what was published. Deletes `hasPublished` as a separate flag
(derivable), the duplicate publish in Settings, and `useDeletePost`'s private fallback. Size M (store, hook, screen, one
caller).

## 4. Own-events sync ownership and newness

**Files.** `app/shared/lib/nostr/ownsync/useOwnEventsSync.ts:80-148`; `partitionOwnEvents.ts:92-161`.

**Variables.** `pubkey`, `filters` (memo on `pubkey`), `events` from `useSubscribe`, `processedRef` (ids seen),
`lastProfileCreatedAtSecRef`, `activeAccountIndex`; two effects where the first resets what the second reads.

**States.** `idle` (no keys), `syncing(owner, seenIds, profileNewest:{at,id})`. Event: batch, account change.

**Meaningless combinations.** `processedRef` reset for account B while `events` still holds account A's batch
(the subscription is swapped by `useSubscribe` after the same commit). Newness kept as a timestamp only while the
partition orders by timestamp then id (the own-profile tie-break item, since fixed).

**Reachable today.** Pinned as a QUIRK in `app/__tests__/useOwnEventsSync.test.tsx:244-258`: after an account change a
batch still holding the previous account's like is ingested into the new account's profile-scoped
`nostr-social-store`. Reached in the app only with Settings → in-process profile switch on
(`settingsStore.inProcessProfileSwitch`, default off). No author check exists (`applyProfile` checks the active
profile; likes, reposts, replies, notes and deletions do not). Defect D7.

**Persisted.** Writes `nostr-social-store`, `own-content-store`, owned media and the profile store. The hook itself
holds nothing.

**Consumers.** Root layout only; the stores it feeds have many readers.

**Pins.** `useOwnEventsSync.test.tsx` (11 cases, three QUIRKs), `partitionOwnEvents.test.ts`,
`nostrSocialStoreOwnSync.test.ts`.

**Recommendation: convert.** One `useReducer`-free module object keyed by owner: `{ owner, seen, profileNewest: {at,
id} }`, created per pubkey, and a filter `event.pubkey === owner` before partitioning. Fixes the own-profile tie-break item and D7 together; the
two QUIRK assertions change on purpose. Size S.

## 5. Notifications session: per-source state

**Files.** `nostr/src/facade/session/notifications-session.ts:111-118` (`per`, `painted`, `closed`, `bestRank`,
three cancel handles, `pendingLive`), `:229-295` (`firstPage`), `:297-321` (`loadMore`), `:191-201` (Primal re-poll).
App side: `app/features/feed/hooks/useNotificationsPage.ts:203-341`.

**Variables.** `per: Map<tier, {cursor, exhausted}>` (a tier absent from the map means "first page still pending"),
`painted`, `closed`.

**States.** Session: `opening → painted → closed`. Per source: `pending`, `ready(cursor)`, `exhausted`, and the missing
one, `backoff`.

**Meaningless combinations.** `exhausted: true` set by a transient failure, which the type cannot tell from the end of
history.

**Reachable today (run).** With one source that answers, then fails once, then would answer: after `firstPage`
`hasMore()` is true; after one failed `loadMore` it is false and a second `loadMore` makes no request
(`{"afterOneFailedLoadMore":false,"calls":2}`, `{"afterSecondLoadMore":false,"calls":2}`). In the app
`useNotificationsPage.loadMore` returns early once `session.hasMore()` is false (`:308`), so a dropped connection while
scrolling ends pagination for that visit with no message. First page: a source that fails or times out (10 s) is
marked exhausted and never asked again until refresh. Defect D4. Also: a re-poll `tick` whose `fetch` throws stops the
re-poll silently (`:196` has no catch; sources normally return outcomes).

**Persisted.** No.

**Consumers.** `facadeNotificationsAdapter.ts`, `useNotificationsPage.ts`.

**Pins.** `nostr/__tests__/facade-notifications-session.test.ts` (7 cases, including "marks a non-advancing source
exhausted", "failed and unsupported sources leave the others serving"), `useNotificationsPage.test.tsx`. Pin first:
failure during `loadMore` (QUIRK today).

**Recommendation: convert** the per-source record to the feed pager's `FeedLaneState`
(`ready | backoff | exhausted | unsupported`, with `failures` and `retryAtMs`), so `hasMore()` counts `backoff` as more.
Size S, one file plus tests.

## 6. `HomeFeed` loader

**Files.** `app/features/feed/components/HomeFeed.tsx:378-405` (state and refs), `:407-430`, `:436-562`,
`:712-784` (three separate phase derivations for logging), `:892-915` (22-field context), `:917-1081`
(`loadFeedImpl`), `:1083-1179` (`loadMoreItemsImpl`); `app/features/feed/hooks/useFeedRetry.ts`;
`app/features/feed/data/feedPagination.ts`.

**Variables.** `isLoading`, `isRefreshing`, `isLoadingMore`, `loadError`, `pageStatus.retryAfterMs`,
`pageStatus.showingRecent`; refs `loadingMoreRef` (mirrors `isLoadingMore`), `activeLoadIdRef`,
`activeAbortControllerRef`, `isFirstRender`, `paginationRef`, `feedItemIdsRef`, `clientRef`, plus the module
`feedPageCache` entry and its freshness.

**States.** `cold`, `paintedFromCache(fresh|stale)`, `revalidating`, `ready`, `refreshing`, `loadingMore`,
`retryScheduled(ms)`, `failed(rows|empty)`; enrichment is a sub-step of `ready`.

**Meaningless combinations reachable today.**
- `isRefreshing: true` with no request running: F185, pinned in
  `app/features/feed/__tests__/homeFeedLoad.test.tsx:361`.
- `loadError: true` with rows from a fresh cache paint (the early return skips `setLoadError(false)`): part of F185.
- One `activeLoadIdRef`/controller is shared by the page-0 fetch, its enrichment, a stale-cache revalidation and
  load-more, so `beginNetworkLoad` from `loadMoreItemsImpl` aborts whichever of the first three is in flight (defect
  D5). The code itself already derives the phase three times for logs (`status`, `phase`, `useStateChangeLogger`),
  which is the union waiting to be written down.

**Persisted.** No (session cache `feed-page-cache`).

**Consumers.** One component; two module functions; `useFeedRetry`; `FeedScreen` mounts it.

**Pins.** `homeFeedLoad.test.tsx` (7 cases), `HomeFeed.test.ts` (retry timer, footer copy),
`engagementRowRenders.test.tsx`, `feedPagination.test.ts`. Pin first: load-more during enrichment and during a stale
revalidation (QUIRK), refresh failure with rows.

**Recommendation: convert.** Move page 0 onto `useCachedRead` as `UserFeed` already does (`UserFeed.tsx:531-547`), and
keep load-more as a small reducer `{ idle | loading(id) | retryAt(ms) | ended }` with its own controller. Deletes
`isLoading`, `isRefreshing`, `loadError`, `isFirstRender` bookkeeping, `activeLoadIdRef`, the fresh-cache early
return, the 22-field context and both phase derivations used only for logs. Size M (one large file, two helpers,
tests).

## 7. `useThread` load phase

**Files.** `app/features/feed/hooks/useThread.ts:135-172` (7 state, 16 refs), `:290-385` (load effect),
`:462-580` (spam audit), `:582-705` (load more), `:707-776` (`fetchThreadImpl`);
`app/features/feed/data/facadeFeedClient.ts:197-231` (never throws; returns `emptyThreadResult(request, read)`);
`app/features/feed/data/feedClient.ts:24-58` (`ReadStatusMeta`, `readIsUnavailable`).

**Variables.** `isLoading`, `isFetching` (+ `isInitialFetchingRef` mirror), `isLoadingMoreReplies` (+ ref mirror),
`hasMoreReplies` (+ `hasMoreRepliesRef` mirror), `error: string | null`, `serverHasMoreRef`,
`allSortedReplyIdsRef: string[] | null` (null = "no stack, page by offset"), `replyOffsetRef`,
`spamAuditStartedRef`, `requestGenerationRef`.

**States.** `cold`, `seeded`, `loaded(stack|offsetPaging)`, `loadingMore(memory|network)`, `exhausted`, `notFound`,
`unavailable`, `auditing` (orthogonal).

**Meaningless combinations reachable today.**
- `result.read.status === 'unavailable'` (every tier failed) arrives as an ordinary result; the hook never reads
  `read`, so unseeded it sets `error: 'Post not found'` (`:747`) and seeded it renders a complete thread with no
  replies, `hasMoreReplies: false`, no error (defect D6). `prefetchThread.ts:55`, `UserFeed` and notifications do
  read it.
- The `catch` branch that sets `'Failed to load thread'` (`:764-767`) is unreachable with the facade client, which
  never throws; `useThread.test.ts:128` pins it with a throwing fake.
- `isLoading: true` forever when a seed exists but `buildThreadItemsFromSeed` returns null and the fetch throws
  (`:349` then `:764` skips `setIsLoading(false)` because `seed` is set). Not reachable with the facade client for the
  same reason.
- A failed network load-more leaves `hasMoreReplies: true` and says nothing (F204).

**Persisted.** No.

**Consumers.** `ThreadView.tsx` (reads `isLoading`, `isFetching`, `error`, `hasMoreReplies`, `isLoadingMoreReplies`).

**Pins.** `app/features/feed/__tests__/useThread.test.ts` (4), `useThreadPaging.test.ts` (9), `threadItems.test.ts`,
`buildThreadStructure.test.ts`, `facadeThreadAdapter.test.ts`, `threadNavigation.test.tsx`. Not pinned: spam-audit
promotion (LEDGER limit), the unavailable result. Pin first: an `unavailable` result, seeded and unseeded.

**Recommendation: convert.** A reducer whose state is a union (`cold | seeded | ready{paging} | notFound |
unavailable`) with paging as `{ kind: 'stack', ids, shown, serverHasMore } | { kind: 'offset', offset } | { kind:
'ended' }`. Deletes the three ref mirrors, the null-means-offset sentinel and the unreachable catch branch. Size M.

## 8. Feed page cursor

**Files.** `app/features/feed/data/feedClient.ts:60-76` (`paginationUntil`, `paginationOffset`, `paginationCursor`,
`hasMore: boolean | undefined`); readers that each derive "has more" differently:
`feedPagination.ts:13-27` (`hasMore ?? items > 0`), `UserFeed.tsx:505-512, 559-563`
(`paginationUntil > 0 && items > 0`, three cursor refs), `useNotificationsPage.ts:249, 308`
(`paginationUntil > 0`); `facadeFeedClient.ts:153-167` (pager per key; ignores `request.cursor`).

**Variables.** Three cursor encodings (seconds sentinel `0`, offset, `{createdAt,id} | null`) and a tri-state `hasMore`.
`HomeFeed.paginationRef.cursor` is a second copy of the facade pager's lane cursors.

**Meaningless combinations reachable today.** After a warm cache paint `loadFeedImpl` disposes the client
(`HomeFeed.tsx:956`), so the facade's `pagers` map is empty while `paginationRef.cursor` still points past page 0; the
next load-more makes a new pager from the top, filtered by `seen` (traced; usually one wasted page, sometimes a
`retryAfterMs` "Retrying…" footer first).

**Persisted.** No.

**Consumers.** 15 files in `features/feed` (`grep paginationCursor|hasMore`), plus `mockPresentationData.ts`.

**Pins.** `feedPagination.test.ts`, `mapNaggFeedPage.test.ts`, `facadeFeedClient.test.ts`, `facadeUserFeed.test.ts`,
`loadUserFeed.test.ts`, `nostr/__tests__/feed-pager.test.ts`.

**Recommendation: convert, after 6.** One `PageContinuation = { kind: 'end' } | { kind: 'cursor', cursor } | { kind:
'offset', offset } | { kind: 'pager' }` produced by each client, so readers stop re-deriving. Size M.

## 9. Profile resolution status

**Files.** `nostr/src/facade/cache/entity-cache.ts:175-176, 232-245` (`pendingProfiles.end` marks
`settledProfiles`); `nostr/src/facade/data-layer.ts:428-447` (`end` also on the all-tiers-failed path);
`app/shared/lib/nostr/useEntityCache.ts:64-98` (`useProfile`); `app/shared/lib/nostr/fetchProfiles.ts:130-161`.

**Variables.** Three parallel stores keyed by pubkey with separate LRU (`profiles`, `pendingProfiles` refcount,
`settledProfiles`), plus `record.seenAt` (0 = boot seed) and `record.picture`.

**States.** `unknown`, `seededLowConfidence`, `loading`, `cached`, `missed`, and the missing `failed`.

**Meaningless combination reachable today (traced).** A fetch that failed on every tier ends `pending`, which marks the
pubkey settled; `useProfile`'s `needsFetch` requires `!settled`, so the row shows the fallback avatar and never
retries for the life of the layer (until an account switch or tier toggle rebuilds it). `useNostrProfileMetadata`
does retry (`fetchProfilesShared.test.ts:126`), so the same failure gives two answers on two surfaces. Defect D8.
Separate LRU means `settled` can be evicted while the record stays (harmless refetch).

**Persisted.** No (the durable mirror holds only records).

**Consumers.** `useProfile`, `useNostrProfileMetadata*`, `fetchProfiles.ts`, data layer.

**Pins.** `fetchProfilesShared.test.ts`, `useProfileRecordsMany.test.ts`, `useNostrProfileMetadataResolving.test.tsx`,
`nostr/__tests__/facade-pending.test.ts`, `facade-entity-cache.test.ts`.

**Recommendation: convert.** Record settlement as `{ settledAt, outcome: 'answered' | 'missed' | 'failed' }` and let
`failed` be retryable after a delay. Size S (two files plus tests).

## 10. Composer session and the two post flows

**Files.** `app/features/composer/state/composerStore.ts:31-77`; `app/features/composer/publish/useComposerActions.ts:51-91`
(`publishPoll`), `:105-192` (`publishComposed`), `:195-218`; `app/features/composer/ui/PostComposer.tsx:84-164,
218-226`; `app/features/feed/components/ThreadReplyBar.tsx:153-232, 268-297`.

**Variables.** Store: `target: ComposerTarget | null` (null = closed), `blocks`, `poll?`, `parentEvent?`;
media block `descriptor?` and `uploadProgress?` encode `local | uploading | uploaded`. Screen: `busy`, `error`,
`postProgress`, `postingRef`; reply bar: `posting`, `postingRef`.

**Meaningless combinations.** `target: null` with a full draft (`close()` clears only `target`; pinned on purpose in
`composerStore.test.ts:66`); `poll` with `target.mode === 'reply'` (published with no reply tags, F204);
`busy: false` with `postProgress` set; `uploadProgress` set with a `descriptor`.

**Reachable today.** Poll as reply: yes (F204, `ThreadReplyBar.tsx:442` → `expandToFull(true)`). The others need a
`/composer` entry without `open()`; only two callers navigate there and both call `open()` first, so not reached.

**Persisted.** No (session store, deliberately).

**Pins.** `composerStore.test.ts`, `composerPost.test.tsx`, `threadReplyPost.test.tsx`, `publishPoll.test.tsx`,
`composerCore.test.ts`, `publishComposed.test.ts`.

**Recommendation: convert, small.** `ComposerSession = { status: 'closed' } | { status: 'open', target, draft }` with
`poll` allowed only where the owner decides (F204 is the wire question), and one `runPost` shared by the composer and
the reply bar (they already share `uploadMediaBlocks`). Deletes the half-reset and one of the two post flows. Size
S-M.

## 11. Block state (defer)

**Files.** `app/features/feed/stores/ignoreStore.ts:22-29, 117-190`; `app/features/feed/lib/moderation.ts:13-19,
98-114`; `app/shared/lib/nostr/moderation.ts:132-246`.

**Variables.** Per person: membership in `ignoredPubkeys` (effective), in `muteList` p-tags (last published copy),
`blockOverrides[pk]: true | false | absent` (local intent not yet confirmed). `ignoredPubkeys` is derived from the
other two plus purely local hides, and stored.

**States.** `unblocked`, `blockedSynced`, `blockPending`, `unblockPending`. 12 combinations of the three variables;
`ignored = false, override = true` is reachable only through `clearIgnoredFeedItems` (`:190`), which has no caller
outside tests. A failed `setPersonBlocked` leaves the override pending until the next block action (no retry on
foreground: `syncMuteList` reads, never publishes); local protection holds, so this is intended per the comment at
`moderation.ts:148`.

**Persisted.** `feed-ignore-store` (profile scope): all four fields, tolerant reader. Public wire: kind 10000.

**Pins.** `moderationStore.test.ts`, `moderationRelay.test.ts`, `feedIgnoreStorePersisted.test.ts`,
`feedPreferenceStores.test.ts`, `ownSyncLifecycle.test.tsx`, `postMenuActions.test.tsx`.

**Recommendation: defer.** It is a deliberate last-writer-wins merge, well pinned, persisted and published; the only
reachable oddity has no production caller. Delete `clearIgnoredFeedItems` in pass 3 instead.

## 12. Feed pager lanes (leave)

`nostr/src/facade/feed-pager.ts:13-23, 67-76`. Already a named union (`FeedLaneState`) plus `failures`/`retryAtMs`
meaningful only in `backoff` and `boundaryGrace` only for cursor lanes. The draft-then-commit design prevents torn
states; abort leaves lanes untouched (pinned in `nostr/__tests__/feed-pager.test.ts`). Tightening `failures`/`retryAtMs`
into the `backoff` variant is cosmetic. **Leave.**

## 13. Like, repost and zap overlays (leave)

`app/features/feed/hooks/useNostrEngagement.ts:35-163, 180-252`, `engagementToggle.ts`, `engagementOverlay.ts`,
`nostrSocialStore` optimistic maps. Already explicit: intent in the overlay, one module-level loop per action,
settlement by a pure rule, resume of pending intents. `delta` is stored beside `expectedCount` (derived value), and
`reconcilingActions` is not account-scoped, but no reachable illegal state was found. Pinned by
`engagementBehaviour.test.tsx`, `engagementToggle.test.ts`, `engagementOverlay.test.ts`, `zapOptimisticPersist.test.ts`.
**Leave.** It is the model for candidate 2.

## 14. Image overlay phase (defer)

`app/features/feed/components/nostr/image-overlay/provider.tsx:239-330, 385-410`, `AnimatedImageOverlay.tsx`.
`imageState: 'open' | 'close'`, `isClosing`, `openAnimationInProgressSv`, `closeSpringsDoneCount` jointly encode
`closed | opening | open | closing` on the UI thread; `activeUrls` and `activeMediaTypes` are parallel arrays and the
delayed clear empties only `activeUrls`, so their lengths differ for `CLEAR_URL_DELAY_MS` (readers guard on length).
No saved data, no money, worklet code, not pinned (`AnimatedImageOverlay`, `BottomPanel` have no tests). **Defer**
until it is pinned on a device.

## 15. Capability cache

`nostr/src/capabilities.ts:43-69`: `cached?` and `pending?` with no generation. the capability-cache item (since deleted) (no caller; stale request
repopulates after `clear()`). **Delete** per the capability-cache item (since deleted) rather than convert.

Also looked at and left: gift-wrap unwrap cache (`giftWrapCache.ts`, positive and negative persisted maps; F02 and F203
item 4 decide its future), `useMuteListSync` (`loading` local per effect run; pinned "one refresh at a time"),
`useOwnSocialGraphSeed` (F203 item 3), `buildNostrDataLayer` memo (owner check pinned in `nostrDataLayerMirror` and
`nostrDataLayerRebuild`), the DM screen's echo list (`UserMessagesScreen.tsx:139-194`, `isSending` plus presence in
the server list; session only, thread state is owned by payments' `useDmThread`), poll vote (`PollCard.tsx:45-90`,
F185), delete-post legs (`useDeletePost.ts`, legs keyed by normalised URL; pinned by `executeDeletePost.test.ts`).

---

## Defects (not in `docs/follow-ups/`)

**D1. Following someone can replace the whole follow list with one entry.**
`app/features/user/screens/UserProfileScreen.tsx:1081-1099` with `nostrSocialStore.ts:449-470` and
`useOwnEventsSync.ts:89-90`. Path: account whose kind 3 the own-events subscription does not return (older than one
year, or behind 5,000 newer own events, or simply not arrived yet); `useOwnSocialGraphSeed` fills `followingPubkeys`
from the facade, `contactsTags` stays `[]`; tap Follow; a kind 3 with one `p` tag is published to every write relay.
Traced. Failing test: seed follows `[x, y]` through `seedFollowsFromFacade`, `contactsTags: []`, toggle follow `z`,
expect the published tags to contain `x` and `y` (or no publish). Repair touches a published wire event (what is sent),
not stored shape.

**D2. A follow interrupted by closing the app locks that person's Follow button for good.**
`nostrSocialStore.ts:474-507`, `UserProfileScreen.tsx:1075, 1289`. Path: tap Follow, kill the app before the publish
settles; on restart `optimisticFollowsByPubkey[pk].pending` is still true, the button shows the intent and does
nothing, and no code clears or resumes it. Traced. Failing test: rehydrate `{ value: true, pending: true }`, tap the
button, expect a publish. Repair reads saved data (`nostr-social-store.optimisticFollowsByPubkey`); decoding at
rehydrate keeps the shape.

**D3. A relay edit made while the list is publishing is marked published and never sent.**
`app/features/settings/screens/SettingsNetworkScreen.tsx:54-80` (publishes the `entries` captured at tap, then
`markPublished`), `relayListStore.ts:137-139` (`source: 'relay'`), rows stay editable (`:322-328`). Path: tap
"Publish relay list", toggle a relay's write switch before it finishes; on success `source` becomes `'relay'`, the
"Publish" button disappears, the edit stays only on this phone. Traced. Failing test: start publish with a deferred
`publishEvent`, `setMarker`, resolve, expect `source === 'local'`. Repair touches saved data
(`nostr-relay-list-store.source`), no shape change.

**D4. One failed page ends notification paging for the visit.**
`nostr/src/facade/session/notifications-session.ts:303-306` (and `:245-247` for the first page). Run: `bun -e` with a
fake source, `hasMore()` false after one failed `loadMore`, no further requests. Failing test (extend
`facade-notifications-session.test.ts`): a source that fails once then answers keeps `hasMore()` true and is asked
again. Memory only, no wire change.

**D5. Scrolling to the end of the home feed cancels page 0's enrichment or a stale-cache revalidation.**
`app/features/feed/components/HomeFeed.tsx:407-414` (`beginNetworkLoad` aborts the shared controller) called from
`:1109`; victims at `:1046-1052` (enrich) and `:1014-1027` (revalidation). Path: page 0 paints, `onEndReached` fires
(short list or quick scroll) while `client.enrich` is pending; the enrichment rejects as aborted and is dropped by
`isActiveLoad`, so quoted posts and names for page 0 stay unfilled; on a stale cached tab the revalidation is dropped
and the stale page stays. Traced; whether rows refill names through `useProfile` was not checked. Failing test
(extend `homeFeedLoad.test.tsx`): deferred enrich, trigger end reached, resolve, expect page 0's quoted event applied.
Memory only.

**D6. A thread that every source failed to load says "Post not found", or looks complete.**
`app/features/feed/hooks/useThread.ts:741-756` never reads `result.read`; `facadeFeedClient.ts:213-223` returns
`emptyThreadResult(request, readUnavailable(...))`. Path: open a thread from a link while offline (unseeded) → "Post
not found"; open from the feed (seeded) → the post with no replies, no error, no retry. Traced. Failing test: fake
`getThread` returning `read: { status: 'unavailable' }`, expect an error state distinct from not-found. Memory only.

**D7. After an in-process account switch, the previous account's own events can be written into the new account's
stores.** `app/shared/lib/nostr/ownsync/useOwnEventsSync.ts:100-134`; pinned as a QUIRK in
`app/__tests__/useOwnEventsSync.test.tsx:244-258` but never filed. Path: Settings → in-process profile switch on,
switch account while the own-events batch is non-empty; the reset effect clears `processedRef` and the dispatch effect
ingests the old batch (no author check) into the new account's `nostr-social-store` and `own-content-store`. Traced
and pinned. Failing test: flip the QUIRK assertion. Repair touches what is written to saved data, not its shape.

**D8. A profile that failed to load on every tier is never retried by feed rows.**
`nostr/src/facade/cache/entity-cache.ts:237-245` marks settled on any `end`; `data-layer.ts:442-445` calls `end` on
failure; `app/shared/lib/nostr/useEntityCache.ts:75-83` stops fetching once settled. Path: go offline, open the feed,
come back online: rows keep the fallback avatar and name until an account switch or tier toggle rebuilds the layer.
Traced. Failing test: `getProfiles` all tiers fail, then answer; `useProfile` should fetch again. Memory only.

**D9 (suspected, not confirmed). The first-run relay-list publish can overwrite an existing list.**
`app/shared/lib/nostr/outbox/useOwnRelayListSync.ts:38-63` treats `ndk.fetchEvent(...) === null` as "no list
anywhere". If NDK resolves `null` before every relay has answered (timeout, relays still connecting), a newly
imported account publishes the defaults over its real kind 10002. `moderation.ts:190-193` guards the same case for
kind 10000 ("a timeout or unreadable list must never create a replacement"); this path does not. I did not read NDK's
`fetchEvent` to confirm when it resolves `null`. Repair touches a published wire event.

---

## Not read

- `app/features/feed/screens/NotificationsScreen.tsx` beyond its state hooks, `NotificationFollowersScreen.tsx`,
  `ThreadView.tsx` beyond its use of `useThread`, `StoriesCarousel.tsx`, `StoriesScreen`, `PostCard.tsx`,
  `NoteContent.tsx`, `MetricsFooter.tsx`, `PollComposeForm.tsx`, `thread-embed/`, most of `image-overlay/` (only the
  provider's state and the overlay's phase reads).
- `UserProfileScreen.tsx` beyond follow, send-money and its state hooks; `ContactsScreen.tsx` beyond its state;
  `ShareScreen` (pass 0 covered it).
- `nostr/src`: `envelope.ts`, `map/feed.ts`, `recipes/**`, `nagg-tier.ts`, `primal/{tier,demux}.ts`,
  `relay/{tier,demux,for-you/*}.ts`, `session/notifications-merger.ts`, `thread.ts`, `mint-reviews.ts` were read by
  grep only. `tiers/aggregate.ts` and `feed-pager.ts` were read in full.
- `nostrSocialStore` beyond contacts, follows and the selectors; `ownContentStore`, `ownedMediaStore`,
  `pendingZapStore` (payments), `useDmThread` and DM decrypt (payments).
- NDK internals (`fetchEvent`, `useSubscribe` reset timing): the D7 and D9 paths depend on them.
- No test file was run. One `bun -e` trace (D4). Nothing on a device.
