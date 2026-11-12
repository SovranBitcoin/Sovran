# Sweep 1 survey: feed, social features and the Nostr package

Area: `app/features/{feed,composer,contacts,user}`, `app/shared/lib/nostr`, `nostr/src`. Branch `surgery/sweep-1`
at `4c80d9f5c`. Read, not changed. Paths are from the repo root; `N/` is `nostr/src/`, `A/` is `app/`.

How each finding was established is said with it: **run** (a throwaway script outside the checkout), **traced**
(read end to end), or **search** (a word-boundary search over `app`, `wallet`, `nostr`, `site`, `scripts`, `release`,
`harness`, `copy`, `docs`). `bun run knip` passes on this branch; it counts a test as a caller, so every "only tests
import it" below comes from the search, not from knip.

Not repeated here: F09, F101, F122, F125, F185, F203, F204, F216, F218, F221, F223, F227, F239, F240, F241, F242 and
group C of pass 3 (`getOwnHistory`, `discoverMints`, `clearIgnoredFeedItems`, `decodeMuteList`, `isFirstRender`).
`isFirstRender` is gone; `clearIgnoredFeedItems` (`A/features/feed/stores/ignoreStore.ts:36`, `:190`) is still there
with no caller, as pass 3 left it.

Counts: Broken 7 (4 fix), Inconsistent 8 (4 fix, one of them only in part), Inefficient 2 (0 fix), No longer needed
11 (5 fix), Regrown 3 (1 fix). 31 findings, 14 marked fix.

---

## 1. Broken

### B1. Load more on a notifications tab can page another tab's session and replace the list with it. **fix**

`A/features/feed/hooks/useNotificationsPage.ts:203` keeps one session owner for the hook, with no key on it. The
session is opened (and the previous one closed) only inside the fetcher (`:220-252`). `useCachedRead` does not call
the fetcher when the new key's cached page is fresh (`A/shared/lib/read/useCachedRead.ts`, the `serve-fresh` return
before `abortRef.current?.abort()`), and the page cache is fresh for 60 s (`A/features/feed/data/notificationsCache.ts`).

Path: open Notifications on All (session A) → tap Mentions (fetcher runs, A closed, session B) → tap All again within
60 s (cached page painted, no fetcher, `sessionRef.current.current` is still B) → scroll to the end. `loadMore`
(`:298-323`) takes `session = B`, `base` = All's cached page, calls `B.loadMore()` and `setExtra({ key: <All key>,
result: <B's snapshot> })` (`runLoadMore`, `:116-120`). The All tab now shows the Mentions session's rows, and
`hasMoreRef` is B's. The same hook-wide sharing applies to `hasMoreRef` and `seenKeysRef` on the no-session path, and
B's subscription keeps writing B's key while All is on screen (harmless: it captured its own key).

Traced; `A/__tests__/useNotificationsPage.test.tsx` pins the synchronous paint of a cached tab, not a load-more after
it. Test idea: fetch tab A, fetch tab B, switch back to A while fresh, call `loadMore`, expect the result to hold no
row that only B's session returned. Repair: the owner records the key its session was opened for; `loadMore` uses the
session only for that key and otherwise starts a read for the current key (close the stale session on a key change).
Commit: "Page a notifications tab only through the session opened for it". Nothing saved or sent.

### B2. The first tier to answer loses its rank in three aggregate merges, so a worse tier overwrites it. **fix**

`N/facade/data-layer.ts:684-705` (`mergeProfileBundles`): the first answer returns `{ profiles: { ...next.profiles } }`
without recording an owner in `rankOwners`, and `rankOwner` defaults to `'relay'`. A later answer from any tier then
passes `tierRank(tier) <= tierRank('relay')` and replaces the first one's metadata. `mergeNoteStatsByRank` (`:708-722`)
and `mergeSocialGraph` (`:834-854`) record the owner on `next` and return a copy, so the accumulator has no owner
either.

Run: Primal answers `{A: 'primal-name'}` for a two-key request (not yet painted, `minItems` 2), the relay tier then
answers `{A: 'relay-name', B}`. `getProfiles` resolved `A = relay-name` with `tier: 'primal'`, while the entity cache
(which ranks on its own) held `primal-name`. The comment at `:683` and the test title "a better-ranked later answer
wins the cached fields; a worse-ranked one cannot erase them" (`nostr/__tests__/facade-profiles-aggregate.test.ts:74`)
state the opposite rule; that test only covers the cache. The note-stats case is not visible today (the read paints
on its first non-empty answer and later merges go to the cache only); the social-graph case only decides a tie on
`created_at`.

Test idea: the run above as a vitest case on the resolved value. Repair: record the tier on the object each merge
returns. Commit: "Keep the answering tier of the first aggregate answer". Nothing saved or sent.

### B3. A search hit that only says which AI providers a person runs is not written to the profile stats. **fix**

`N/facade/cache/ingest.ts:134-142`: the "nothing to write" check tests followers, following, score, rank and
`operatesMints`, and forgets `operatesAiProviders` (and `vertexFetchedAt`). A hit with null figures and an
`operatesAiProviders` list is skipped, so the link from the person to the provider never reaches the one owner the
profile page and provider rows read (`ingestIdentities` at `:159-196` writes it unconditionally). Traced. Test idea:
`ingestSearchHits` with `{ operatesAiProviders: ['x'] }` and every figure null, expect `getProfileStats` to hold it.
Commit: "Write a search hit that only carries what the person operates". Memory cache only.

### B4. A failed delete leaves an unhandled rejection. **fix**

`A/features/feed/hooks/useDeletePost.ts:203-206` marks the toast failed and then rethrows; its only caller discards the
promise (`A/features/feed/hooks/usePostActions.ts:46`, `void deletePost(event)`). The person already sees the failed
toast; the rethrow reaches nothing but the unhandled-rejection handler. Traced. Test idea: make `publishEvent` throw,
expect the hook's promise to resolve. Commit: "Do not rethrow a delete failure the toast already shows" (or catch at
the call). Nothing saved or sent.

### B5. Deleting your own poll (or any post that is not kind 1) sends `k` = `1`. **list**

`A/features/feed/hooks/useDeletePost.ts:145-149` hardcodes `['k', '1']`. The composer publishes kind 1068 polls
(`A/features/feed/components/nostr/poll/buildPollEvents.ts`), the feed also carries kind 1111, and the post menu offers
Delete on any event the viewer authored. The like/repost retraction in the same feature derives the kind
(`useNostrEngagement.ts:105`). Traced. Changes what is published, so the owner decides: send `String(event.kind)`.
Related, same owner's call: `publishOwnAction` (`useNostrEngagement.ts:78-92`) reposts every kind as kind 6 with no
relay hint on the `e` tag (NIP-18 asks for kind 16 with a `k` tag for anything but kind 1, and a relay URL).

### B6. A profile header keeps the first tier's name and picture and stamps them with a later tier's rank. **list**

`N/facade/data-layer.ts:486-494` and `mergeProfileStats` (`:725-740`): fields are "first answer wins"
(`acc.metadata ?? next.metadata`), and each merge is written back with `ingestProfileStats(cache, { tier, ...merged })`
where `tier` is the tier that just answered. If the relay floor answers before nagg, the relay's kind 0 is returned,
then re-ingested at nagg's rank, and nagg's own metadata is dropped from both the result and the cache. The profiles
surface next to it uses rank (B2). Traced, not run. Needs a ruling: counts are documented as "fill what is undefined";
whether metadata should follow rank instead is a product rule.

### B7. A relay that drops stops feeding the live notifications listener for the rest of the visit. **list**

`N/facade/relay/protocol.ts:229-240`: the long-lived `subscribe` passes `onClosed: () => {}`, and
`N/facade/relay/socket-pool.ts` drops a socket on error, close or a refused frame. Nothing resubscribes. The DM side
documents this ("no auto-reconnect", poll backstop, `data-layer.ts:157-159`); the notifications session's only backstop
is the Primal re-poll (`N/facade/session/notifications-session.ts:270-280`), which does not exist when the Primal tier
is off or its hosts are disabled in Network settings. After a background/foreground cycle with Primal off, new rows
arrive only on refresh. Traced. Owner decides: resubscribe on drop, or re-poll the relay tier too.

---

## 2. Inconsistent

### I1. Four tables rank the tiers. **fix** (two identical), **list** (the rest)

`N/tiers/aggregate.ts:85-89` (`TIER_ORDER`, `rankOf`) and `N/facade/data-layer.ts:658-662` (`TIER_RANK_ORDER`,
`tierRank`) are the same list and the same function. `N/facade/session/notifications-session.ts:282-285` has a third
inline (`['nagg','primal','relay']`), and `N/facade/cache/entity-cache.ts:29-39` a fourth with the opposite sign
(`sourceRank`, higher is better). Commit: "Rank tiers in one place" (export `rankOf` from `tiers`, use it in the data
layer and the session). Folding in `sourceRank` changes a sign every caller compares, so that part is listed.

### I2. The Vertex refresh talks to the unversioned nagg routes; every other client uses `/v1`. **list**

`A/shared/lib/nostr/vertex/refreshVertex.ts:79` builds `createNaggClient({ appView: { baseUrl } })`; the data layer
(`buildNostrDataLayer.ts:62`), the feed client (`naggFeedClient.ts:78`) and the wallet's mint enrichment pass
`version: 'v1'`. So a search is sent to `/v1/nostr/search` and its paid refresh to `/nostr/search`. The sibling `nagg`
checkout appears to mount both; not confirmed for the deployed server. A request that 404s here has already taken a
budget unit and marked the query attempted for the day (`:72-74`). Owner or nagg decides which prefix is meant.

### I3. Three ways to send a NIP-17 message, two rules for where it goes, none through the publish seam. **list**

- Payment requests: `sendDirectMessageToRelays` (`A/shared/lib/nostr/sendDirectMessage.ts`), to the recipient's hints
  or kind 10050 relays, "never guess: a wrap on the wrong relay is spent ecash the payee will never see".
- Ecash to a contact: `publishGiftWrappedDM` (`A/shared/lib/nostr/publishGiftWrappedDM.ts:56-65`), bare
  `NDKEvent.publish()` to whatever the pool holds.
- Chat: `A/features/user/screens/UserMessagesScreen.tsx:380-487`, the same pair of publishes written inline (the
  helper's header says so, `:5-9`), again bare `.publish()`.

`publishEvent` calls itself "the single seam every Nostr write routes through" (`publish/publishEvent.ts:2-6`); these
five `.publish()` calls are the ones left. The chat copy cannot simply call the helper (it needs the self-copy id
before publishing, for the echo). Money is involved in the second, so: owner's ruling on one relay rule for a wrap that
carries ecash.

### I4. Post enrichment bypasses the tiers and the Network toggles. **list**

`createFacadeFeedClient` overrides every read except `enrich`, which falls through to the nagg REST client
(`A/features/feed/data/facadeFeedClient.ts:128`, `naggFeedClient.ts:620-679`), built from `backendConfig` and blind to
`naggTierEnabled`. With nagg switched off or down, pages arrive from Primal or relays and their quoted posts are asked
of nagg only (`HomeFeed.tsx:1033`, `:1143`, `UserFeed.tsx:981`, `loadUserFeed.ts:78`,
`nostrSigner/hooks/useReferencedEventPreview.ts:48`). Author names recover through `useProfile`'s backfill; quoted
events do not. Traced. A facade read for "events by id" does not exist yet, so this is a build, not a cleanup.

### I5. Six copies of "note stats to feed metrics", and a second "metrics to stats" that skips the contract. **fix**

`{ likeCount: s.likes, repostCount: s.reposts, replyCount: s.replies, satsZapped: s.satsZapped }` is written out at
`A/features/feed/hooks/useThread.ts:74-79`, `:522-527`, `A/features/feed/data/facadeThreadAdapter.ts:144`,
`A/features/feed/data/facadePageMaps.ts:10-15`, `A/shared/lib/nostr/useEntityCache.ts:225-230`, `:246-251`. The
reverse exists twice: `facade.statsFromMetrics` (`N/facade/feed.ts:119-131`, through `toNoteStats`) and a local
`noteStatsFromMetrics` (`A/shared/lib/nostr/fetchNoteStats.ts:26-35`) that bypasses `toNoteStats` and always writes
`zaps: 0`. Commit: "One conversion between note stats and feed metrics, each way" (one helper beside
`readNoteMetrics`; `ingestFeedMetrics` calls `facade.statsFromMetrics`). The six sides are identical; the `zaps: 0`
overwrite is not read by anything today.

### I6. Three tolerances for a list dated in the future. **list**

Follow list 60 s (`A/shared/lib/nostr/followSync.ts:151`, comment "as for the mute list"), mute list a literal `+ 60`
(`moderation.ts:28`), profile 300 s (`profile/publishOwnProfileMetadata.ts:40`). Belongs with pass 3's group C5 (one
owner for read-change-publish); listed so that owner picks one number.

### I7. Comments and docs that describe code that is gone or moved. **fix** (comments only)

- `A/features/feed/data/facadeFeedClient.ts:37-43`, `:62-63`, `:84-91`: "nagg GraphQL fast-paths (thread, user feeds,
  posts-by-pubkey)", "Threads keep nagg's viewer-ranked GraphQL gold path", "following-replies still delegate to the
  legacy client". The same file's `getThread` says the bypass is gone (`:198-202`); only a viewerless `getFeed` and
  `enrich` reach the nagg client.
- `A/features/feed/data/useFeedClient.ts:6-8`: "everything else delegates to the existing nagg feed client".
- `N/facade/placeholders.ts:6-12`: "The Primal WS client and the raw-relay adapter are built in follow-up steps". Both
  exist.
- `N/facade/relay/tier.ts:484-489`: "handled once the social-graph surface lands", "same gap". `feedPage` resolves the
  kind 3 itself at `:85-95`.
- `N/facade/relay/for-you/build.ts:27-28`: "the app's facade hardcodes the cursor id to ''". The pager passes the
  cursor whole.
- `A/shared/lib/nostr/nostrTierConfig.ts:6-17`: "(Settings → Developer)", "`@sovranbitcoin/nagg-ts`", "ships safely
  while the app still resolves nagg-ts to the published registry version". The toggles are in Network settings and the
  package is the `nostr` workspace. "nagg-ts" also at `useEntityCache.ts:18`, `:103`, `buildNostrDataLayer.ts:42`,
  `useThread.ts:54`, `useOwnSocialGraphSeed.ts:3`, `N/schemas.ts:16`.
- `A/shared/lib/nostr/fetchProfiles.ts:17` ("Primal `user_infos` → raw relays": it is a fan-out) and `:168-169`
  ("Reputation is NOT here": `ProfileStats` carries `score` and `rank`).
- "Nagg GraphQL" for a REST read: `A/features/contacts/hooks/useAllSearchResults.ts:4`,
  `useOverlaidContactSearch.ts:5`, `A/features/feed/lib/notificationGroups.ts:166`,
  `A/features/feed/hooks/useRecentPeopleProfiles.ts:19`; and the fallback message `'GraphQL request failed'` for a
  failed fetch (`N/errors.ts:21`), which reaches logs.
- `N/facade/nagg-tier.ts:7-17`/`:72`, `:18-24`/`:71`, `:28-32`/`:73`: three modules imported twice each.

Commit: "Correct comments that describe the removed GraphQL and legacy feed paths".

### I8. F125 points at a file that does not exist. **fix**

`docs/follow-ups/F125.md:8` cites `app/shared/lib/nostr/outbox/dmRelayDiscovery.ts`; the file is
`app/shared/lib/nostr/dmRelayDiscovery.ts`. Commit: "Fix the path in F125".

---

## 3. Inefficient

### E1. Row hooks rebuild the tier config on every render. **list**

`useProfile`, `useNoteStats`, `useProfileRecord`, `useProfileRecordsMany` and `useProfileFetchSettlements` call
`buildNostrDataLayer()` in render (`A/shared/lib/nostr/useEntityCache.ts:68`, `:108`, `:135`, `:191`, `:219`). Each call
reads the settings store, filters the Primal host list, joins a key and `JSON.stringify`s the whole config including
the default relay array before comparing with the memo (`buildNostrDataLayer.ts:190-196`, `nostrTierConfig.ts:42-60`).
One `PostCard` render makes three such calls (`PostCard.tsx:288`, `:309`, and `useNoteEngagement.ts:114`). The file
already knows: `useCachedProfileStats` says "Peek, never build: this runs in every list row" (`:122`). Not measured;
the first build must still happen somewhere, so the repair is a choice (peek plus a build at the list, or a cheaper
memo key).

### E2. The package's "is anyone listening" guard is always true in the app. **list**

`isNostrLogActive()` (`N/log.ts:39-41`) lets `N/facade/cache/store.ts:179`, `:194` skip building a log record per cache
write. The app installs its bridge unconditionally (`buildNostrDataLayer.ts:43-52`), in release builds too, where the
app logger drops the event after the record is built. Every `nostrLog.debug(...)` in the package likewise builds its
argument object (several map over the tier list) whatever the build. Not measured.

---

## 4. No longer needed

### N1. Three of the nagg feed client's five methods cannot be reached, and a fourth only without a viewer. **list**

`getFeedClient()` is the only constructor call (`A/features/feed/data/useFeedClient.ts:9`) and wraps the nagg client in
`createFacadeFeedClient`, which replaces `getUserFeed`, `getPostsByPubkeys`, `getNotifications` and `getThread`
outright. Its `getNotifications` falls back only when `toFacadeNotificationsRequest` returns null
(`facadeNotificationsAdapter.ts:23`), which the type `FeedNotificationTab = 'ALL' | 'MENTIONS'` rules out; its `getFeed`
falls back only when a Following spec has no viewer key (`facadeFeedAdapter.ts:14-30`; the three home specs are the
only ones, `HomeFeed.tsx:864-872`). So `naggFeedClient.ts:568-618` and `:681-724`, the notifications mapping above them
and most of `mapNaggFeedPage.ts` run only under `A/__tests__/naggFeedClient.test.ts`. With them go the request fields
only they read: `until` and `offset` on `UserFeedPageRequest` and `PostsByPubkeysRequest`
(`feedClient.ts:95-116`; the facade path reads `cursor` alone, `facadeFeedClient.ts:105-122`) and `UserFeed`'s
`paginationOffsetRef` with its three-way branch about "score-based feeds" and "FeedRange" (`UserFeed.tsx:925-947`).
Search and traced. Listed because it deletes tests and needs the owner to say the nagg-only path is not a fallback
being kept on purpose; I4 (enrich) is the one live method.

### N2. The relay "For You" builder is not reachable from the app. **list**

Home feeds go through the pager, and for a ranked spec the pager asks the relay lane for `following-recent` instead
(`N/facade/feed-pager.ts:104-114`). `layer.getFeedPage` is called only with `user` and `following-recent`
(`facadeFeedClient.ts:245`, `:270`, `:314`). So `buildRelayForYouFeed` (`N/facade/relay/tier.ts:75-82`),
`N/facade/relay/for-you/{build,discovery,curated}.ts` (about 560 lines), the `for-you` and `following-popular` arms of
`filtersForSpec` (`tier.ts:479-486`), the always-empty cache that `clearForYouCache` clears on an account switch
(`A/shared/providers/NostrNDKProvider.tsx:238`) and follow-up F101 serve only `nostr/__tests__/relay-for-you.test.ts`.
If it is meant to be served, it cannot be wired as is: it carries an increasing offset in `cursor.createdAt`
(`build.ts:149-151`) and the pager ends a lane whose cursor does not move strictly older (`feed-pager.ts:163-181`).
Owner decides: wire it (with its own paging) or delete it and F101.

### N3. `primaryTierRef` is written and never read. **fix**

`A/features/feed/hooks/useThread.ts:161`, `:193`, `:306` (and the `NostrTier` import at `:4`). The audit reads
`result.tier` and passes the literal `'nagg'`. Commit: "Remove a thread ref nothing reads".

### N4. Exports of `nostr/src/schemas.ts` with no user at all. **fix**

`NaggOrderingSchema` (`:19-22`), `NaggFeedEventShape`, `NaggProfileInfoShape` (`:91`, `:93`), `NaggNoteStats` (`:97`)
and, once that is gone, `NaggNoteMetricsShape` (`:92`): zero references in any workspace, test or doc (search). The
comment above the first (`:15-18`) explains a symlinked package that no longer exists. Left behind when pass 3 deleted
the capability cache and recipes. Commit: "Remove schema exports nothing imports".

### N5. Error variants no code constructs. **fix**

`NaggError` still has `'graphql'` and `'missing_data'`, and `GraphqlError` exists for the first (`N/errors.ts:8-16`).
Nothing builds either (search for the literals: only the type and the app's error map). Their two rows in
`A/shared/lib/errors/index.ts:27-28` go with them. Commit: "Remove the GraphQL and missing-data error variants".
`'endpoint_required'` is built (`N/transport.ts:105`) and stays.

### N6. `consoleNostrLogger`. **fix**

`N/log.ts:47-52`: no importer anywhere (search). Commit with N4.

### N7. `pendingFeedTier` is a test fixture shipped in the package. **fix**

`N/facade/placeholders.ts`: nine test files import it, no product code does, and its comment is I7's stale one.
Commit: "Move the unsupported-tier fixture into the Nostr tests" (a helper under `nostr/__tests__`), deleting the
file and its line in `N/facade/index.ts`.

### N8. The transport logger hook has no production caller. **list**

`NaggTransportLogger`, `NaggRequestLogEvent`, `NaggResponseLogEvent`, `config.logger`, `logAppViewEnd`, the
`variables: {}` field and `logEndpoint` (`N/transport.ts:14-32`, `:50`, `:165-175`, `:259-279`): none of the four
`createNaggClient` calls passes a logger. One test does, to prove a signed Vertex URL is not handed to a logger
(`nostr/__tests__/vertex-request.test.ts:107-126`). Deleting the hook deletes that test's subject; keeping it keeps a
seam nobody uses. Owner's call.

### N9. Test-only envelope reader, and an unreachable branch of the profile fetch. **list**

- `noteStatsFromEnvelope` (`N/envelope.ts:820`): the nagg tier calls `noteMetricsMapFromAggregates` directly; only
  `envelope.test.ts:141` and `appview-feed.test.ts:215` call this. Removing it removes two tests.
- `A/shared/lib/nostr/fetchProfiles.ts:84-95`: the branch for "not a refresh, or a signal was passed". Both callers
  pass `refresh: true` and no signal (`useNostrProfileMetadata.ts:48`, `backfillProfile` at `:151`); only
  `A/__tests__/fetchProfilesShared.test.ts:74` passes a signal. With it goes the cache-first half of
  `data-layer.getProfiles` as far as the app is concerned.

### N10. Dead config beside the area. **list** (outside the area)

`backendConfig.nostrGraphqlEndpoint` and `EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT` (`A/shared/config/backend.ts:44`, `:61`,
`:95-96`, `.env.example`): no reader outside the config and its tests. For whoever sweeps `shared/config`.

### N11. Exports only tests import, left on purpose. **list**

`clearAllSecureData` (`secureStorage.ts`), `getIntegrityFailures` (`accountIntegrity.ts`),
`deriveCashuWalletSeed`, `deriveCashuWalletSeedForImported`, `deriveCashuWalletSeedFromRoot` (`keyDerivation.ts`),
`applyProfilePatch`, `blossomSha256FromUrl`, `buildImetaTags`, `executeDeletePost`, `useFollowToggle`,
`UserProfileIdentityRow`, `planFollowPublish`, `applyFollowIntents`, `parseReviewEvent`, `coerceTags`,
`notificationMergeKey`, `targetAuthorFromReaction`. Each is a pure core exported for its test, or guards keys and
storage. Not candidates; recorded so the next sweep does not re-derive the list. `serializeDmRelayList` is F125.

---

## 5. Regrown

### R1. `within` in the follow worker is `settleWithin` again. **fix**

`A/shared/lib/nostr/followSync.ts:226-239` (pass 2, one caller at `:273`) races a promise against a timer and clears
it, returning `undefined` on timeout. `A/shared/lib/profile/settleWithin.ts` is the same function returning
`TIMED_OUT`, with eleven callers. Commit: "Use settleWithin for the indexers' last answer".

### R2. Two ways a follow overlay is removed, and one state neither handles. **list**

Pass 2 made the worker the owner: a tap writes `pending: true` (`nostrSocialStore.ts:551-559`), the worker removes the
entry with `settleFollowIntents`. `useOwnEventsSync.ts:182` still calls the older `clearSettledFollowOptimistic`
(`nostrSocialStore.ts:577-593`) on every contact list, which removes entries that are not pending and agree with the
list. No current code writes a non-pending entry, so that call only ever acts on entries saved by 0.1.3. One such
entry that disagrees with the list is kept by it, is not an intent (`selectFollowIntents`, `:837-844`, pending only)
and is still what the button shows (`selectIsFollowingPubkey`, `:846-850`): "Following" for someone not on the list
until the next tap. Saved data, so listed: decide whether a released non-pending overlay is dropped on load, treated
as an intent, or left.

### R3. The notifications session borrows the pager's state names and adds its own rank list. **list**

`N/facade/session/notifications-session.ts:45-61` builds `SourceState` from `Extract<FeedLaneState, …>` plus two local
states, and `:282-285` adds the third tier-rank list (I1). The pager and the session now share four words and no
code; if the pager's lane states change, the `Extract`s silently become `never`. Low value; listed so a later pass
either shares the transition or stops borrowing the names.

---

## Not read

- `nostr/src`: `envelope.ts` (exports and three functions only), `map/feed.ts`, `facade/thread.ts`,
  `facade/feed.ts` (two functions), `facade/notifications.ts`, `facade/search.ts`, `facade/social-graph.ts`,
  `facade/dm.ts`, `facade/own-state.ts`, `facade/profiles.ts`, `facade/profile-stats.ts`, `facade/note-stats.ts`,
  `facade/noteStatsContract.ts`, `facade/mint-reviews.ts`, `facade/event.ts`, `facade/vertex-request.ts`,
  `facade/cache/read-thread.ts`, `facade/primal/{tier,demux,schemas}.ts`, `facade/relay/demux.ts`,
  `facade/relay/for-you/{build,discovery}.ts` beyond the header and cursor code, `recipes/{rank,appview-feed,
  appview-social,dm,profile-search,vertex}.ts` beyond their exports, `tiers/{types,audit}.ts`, `timeout.ts`,
  `transport.ts:130-160`.
- `app/features/feed`: `HomeFeed.tsx` and `UserFeed.tsx` beyond the load-more body (passes 2 and 3 read them),
  `NotificationsScreen.tsx`, `NotificationFollowersScreen.tsx`, `ThreadView.tsx`, `ThreadReplyBar.tsx`, `PostCard.tsx`,
  `NoteContent.tsx`, `MetricsFooter.tsx`, `StoriesCarousel.tsx` and the stories files, all of `image-overlay/`, all of
  `thread-embed/`, `PollCard.tsx`, `pollParse.ts`, `feedParse.ts`, `naggFeedClient.ts:1-470`, `feedClient.ts:1-60`,
  `facadeThreadAdapter.ts`, `facadeNotificationsAdapter.ts` beyond the request mapper, `lib/*` except
  `engagementOverlay.ts`, `engagementToggle.ts` and part of `loadUserFeed.ts`, `useZap.ts`, `useFeedContentState.ts`,
  `useFeedRows.ts`, the stores, `FeedScreen.tsx`, the demo components.
- `app/features/composer`: `PostComposer.tsx` beyond the post runner, `PollComposeForm.tsx`, `buildNoteEvent.ts`,
  `config/*`.
- `app/features/contacts`: everything except `useAllSearchResults.ts`.
- `app/features/user`: `UserProfileScreen.tsx` beyond the follow toggle, `UserMessagesScreen.tsx` beyond the send
  handler, `ShareScreen.tsx`, `ShareRoute.tsx`, `SendMessageMenu.tsx`, `sendMessageRecommendation.ts`.
- `app/shared/lib/nostr`: `secureStorage.ts`, `derivationIntegrity.ts`, `accountIntegrity.ts`, `loadAccountKeys.ts`,
  `keyDerivation.ts`, `reduxEraRoot.ts`, `phraseStretch.ts`, `nip17.ts`, `nip04.ts`, `giftWrapCache.ts`, `memoMentions.ts`,
  `nutzapProfileDiscovery.ts`, `nip61NutzapProfile.ts`, `dmRelayDiscovery.ts`, `sendDirectMessage.ts:1-99`, all of
  `media/`, `profile/*`, `zap/buildZapRequest.ts`, `outbox/{nip65,nip17DmRelays,recipientRelays,resolveWriteRelays,
  seedPool,defaults}.ts`, `ownsync/partitionOwnEvents.ts`, `publish/{types,constants}.ts`, `nip11.ts`,
  `fetchMintReviews.ts`, `reviewAggregate.ts`, `extractMintNostrPubkey.ts`, `identityCache.ts`, `e2eSeedExport.ts`,
  `vertex/signVertexRequest.ts`, `refreshVertex.ts:1-20`.
- Tests were read only where a finding cites them. No test file was run; one throwaway `bun` script (B2). `bun run
  knip` and ESLint on the four files with suppressions in the area were run: knip is clean, and no suppression there
  is stale. Nothing on a device, no relay or server contacted. NDK internals were not read (B7 and I3 depend on how
  `NDKEvent.publish()` and a dropped relay behave). Whether the deployed nagg mounts both route prefixes (I2) was
  inferred from the sibling checkout, not checked.
