# Pass 3 survey: feed, social features and the Nostr package

Area: `app/features/{feed,composer,contacts,user}`, `app/shared/lib/nostr/**`, `nostr/src/**`, and the two relay-list
publishers the pass 2 survey assigned here (`app/shared/lib/nostr/outbox/useOwnRelayListSync.ts`,
`app/features/settings/screens/SettingsNetworkScreen.tsx`). Checkout `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery`,
branch `surgery/pass-3` (pass 2's head; nothing changed since). Paths are from the checkout root.

Method: started from pass 0 (`feed-social.md`, `nostr.md`) and pass 2 (`feed-social-nostr.md`) candidate lists and
the ledger's pass 2 conversions; read every file named below; grepped every caller of each interface (counts are
production files, tests listed separately); grepped `docs/follow-ups/` before calling anything a defect. `bun run
knip` at the root reports nothing: the `nostr` package's entry files export everything, so knip cannot see its dead
surface; the nostr findings below come from a grep of every `export` in `nostr/src` against `app/` and `wallet/`
(script output kept in the scratchpad, not in the repo). No test was run. Everything is "traced" (read end to end)
unless it says otherwise.

Already filed and cited, not repeated: F185, the capability-cache item (since deleted), F203, F204, F216, F221, F227, F239.

---

## The question asked: one owner for "read the newest own replaceable event, change it, publish it to the relays read"

Pass 2 added `app/shared/lib/nostr/ownReplaceableEvent.ts` (`captureProfile`, `validOwnEvent`, `matchingSigner`,
`readNewestOwnEvent`). Today four kinds are replaced by the app, by five writers, under five sets of rules:

| Rule | Mute list 10000 (`moderation.ts:69-161`) | Follow list 3 (`followSync.ts:287-410`) | Profile 0 (`publishOwnProfileMetadata.ts:172-296`) | Relay list 10002, first run (`useOwnRelayListSync.ts:95-110`) | Relay list 10002, Settings (`SettingsNetworkScreen.tsx:54-82`) |
| --- | --- | --- | --- | --- | --- |
| Read | `readNewestOwnEvent` over `getOwnWriteRelays()` | same, only after `getKnownOwnWriteRelays` (`:300`) | own subscription over the NDK pool, 3 s (`:93-162`) | `readNewestOwnEvent` over saved write relays plus defaults | none |
| Build only on a complete read | yes (`:44-47`) | yes (`decodeRead`, `:157-165`) | no: a timeout or partial EOSE with any event seen returns `found` (`:113-125`) | yes | n/a |
| Newest rule | `readNewestOwnEvent:110-114`, then `isNewerMuteList` (`feed/lib/moderation.ts:13-19`) | `supersedes` from `nostr` (`:117`) | written twice inline (`:132-138`, `:154-159`) | read rule | n/a |
| `created_at` | `max(now, base+1)` (`:126`) | `max(now, base+1)` (`:359`) | `nextProfileCreatedAtSec` = the same (`:42-45`) | `now` | `now` (`:65`) |
| Account pinned | `captureProfile` | `captureProfile` | its own `useProfileStore.subscribe` (`:187-199`) | effect `cancelled` only | nothing |
| Signer pinned | `matchingSigner` + post-sign check | `matchingSigner` + pre- and post-sign check | inline `signer.user()` check (`:201-209`) and post-sign check | none (`publishEvent` signs with `ndk.signer`; `event.pubkey` never set) | none |
| Publish to | `getOwnWriteRelays()` at publish time (`:139`) | exactly the relays read, re-checked with `sameRelays` (`:372`, `:379`) | `resolveWriteRelays` over own write relays, capped (`:267`) | `DEFAULT_RELAYS` (`:104`) | own write relays plus defaults (`:70`) |
| `resolveOn` | `all-settled` | `all-settled` | `optimistic` | `all-settled` | `all-settled` |
| One at a time | FIFO promise queue per NDK (`:22`, `:94-96`) | coalescing worker per account (`:412-438`) | single flight per pubkey (`:170`) | one effect | `publishing` flag |
| Newer arrived meanwhile | throws `Mute list changed` (`:133-135`) | goes round again (`:372`, `:393`) | not checked | n/a | n/a |

**Would one owner shrink both the mute list and the follow publisher? Yes, but by little in lines; what it buys is one
rule, and the rule is what changes what is sent.**

What the two share line for line: pin the account and signer (moderation `:77-83`, `:97-99`; followSync `:288`,
`:296-297`), read (`:100` / `:304`), build the event with `max(now, base+1)` (`:123-128` / `:356-361`), sign and
re-check pubkey and signer (`:129-132` / `:365-369`), publish `all-settled` and turn an error into a throw (`:136-143`
/ `:376-385`), dispose the scope. About 40 lines in `setPersonBlocked` and 45 in `syncOnce`. Both already keep the
intent in a store and apply every outstanding intent on each pass: the mute list re-applies all of
`ignoredPubkeys` and `blockOverrides` (`:113-116`), exactly as the follow worker applies all of
`selectFollowIntents`. So the shape is the same: `replaceOwnList({ kind, decode(read) → base | wait, apply(base) →
{tags, content} | unchanged, record(event) })` with the account/signer pinning, the read, the relay rule, the
signing, the publish and the per-account worker inside. Estimated: new owner about 90 lines; deletes about 40 from
`setPersonBlocked`, about 45 plus the 27-line worker from `followSync`, and `useMuteListSync` folds into the follow
worker's triggers (43 lines). Net for those two alone: roughly 60 lines down. With the kind 0 editor (drops
`loadOwnProfileMetadata`'s own subscription, about 70 lines, and its own account watch, 13) and both relay-list
writers (about 40 lines to about 15) as further callers: roughly 160 to 180 down.

Why it is not a mechanical pass 3 cut: moving the mute list onto the follow rules changes **what is sent and when**:
it would publish to the relays it read instead of whatever `getOwnWriteRelays()` returns at publish time, and it
would wait (possibly for ever, F227, F239) until this session's relay-list discovery has answered, where today a
block publishes at once to the defaults if discovery has not run. F227's "Done when" already asks for exactly this
("the mute list uses the same read-then-publish rules"), as an owner decision. The same holds for kind 0 (read
relays, complete-read requirement, publish targets, `optimistic`) and the relay list (read-before-replace,
`created_at`). Per the brief: out of scope for this pass; stop there.

What can be cut now without changing anything sent: candidate 4 below (one `signOwnReplacement` tail, one
`created_at` rule, one newest rule). It is the first step of the owner above, and it does not prejudge F227.

---

## Ranking

| # | Candidate | Obligation removed | Rough lines (net) | Risk | Size | Mechanical |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dead Nostr package surface: capability cache, unsent recipe builders | none for callers; maintainers stop fixing code nothing runs | -650 src, -250 tests | none: nothing calls it | M | yes |
| 2 | `HomeFeed` page 0 on `useCachedRead`, load-more on its own controller | 22-field context, four flags, shared abort | -150 | none saved; two pinned QUIRKs flip (F185, F221) | M | mostly |
| 3 | Facade `getOwnHistory` and `discoverMints`: tier-spanning reads with no caller | none (no caller) | -380 src, -150 tests | none sent; contradicts ADR 0003's plan | M | needs owner |
| 4 | One signing tail, one `created_at` rule, one newest rule for own replaceable events | five copies of the same three rules | -35 | none if pinned as below | S | yes |
| 5 | Dead and unread parameters in the feed loaders (`isFirstRender`, unused context fields) | callers build and pass fields nothing reads | -35 | none | S | yes |
| 6 | One relay-list publish function | two publishers, two relay targets, no signer check | -20 | 10002 targets differ only on a defect path; the F216 repair is out of scope | S | yes for the merge |
| 7 | One post runner for the composer and the reply bar | upload-then-publish, guard and outcome mapping written twice | -40 | UI only; the reply bar starts showing errors (F185, F204) | S | mostly |
| 8 | One "ask the indexers for my follow list" (seed hook and follow worker) | the facade social-graph read and seed written twice | -30 | seed lands later; F203(3) | S | no (timing) |
| 9 | One pay address for a Nostr person (zap, profile Send, DM Send) | lud16 check plus npub.cash fallback written three times beside an existing helper | -15 | money: the zap path lower-cases | S | yes except the case |
| 10 | The replaceable-list owner (the question above) | five rule sets to one | -160 to -180 | wire: which relays, when | M | no (F227) |
| 11 | Test-only and dead store/action exports in the area | dead surface | -10 | none | S | yes |
| 12 | Share route wrappers | the same parse, default and title state in two route files | -15 | navigation | S | yes |

Ranked by obligations removed and lines deleted over risk. 10 is listed for the question asked; it ranks low only
because its value comes with a wire change.

---

## 1. Dead Nostr package surface: capability cache and recipe builders nothing sends

**Module.** `nostr/src/capabilities.ts:1-72` (`NAGG_CAPABILITIES`, `NaggCapabilityCache`, `probeServiceInfo`,
`createNaggCapabilityCache`), exported from `nostr/src/index.ts:1`; `nostr/src/schemas.ts:92-122`
(`nameList`, `AppViewCapabilitySchema`, `NaggServiceInfoSchema`, `NaggServiceInfo`), read only by
`capabilities.ts`. Recipe builders in `nostr/src/recipes/` with no caller in `app/`, `wallet/` or the rest of
`nostr/src` (each name appears once in the source, at its definition):

| File | Dead | Lines |
| --- | --- | --- |
| `wallpapers.ts` | the whole file (`wallpaperFilesInput`, `wallpaperAlbumsInput`, `parseWallpaperEvent`, `parseAlbumCatalog`, `parseWallpaperCatalog` and types; the app takes wallpaper types from `@sovranbitcoin/schemas`, `app/shared/stores/global/wallpaperStore.ts:28-29`) | 197 |
| `thread.ts` | the whole file (`authoredReplyChainInput`, `threadReplyRankInput`; `ThreadReplySort` duplicates `app/features/feed/data/feedClient.ts:185`) | 89 |
| `posts-by-pubkeys.ts` | the whole file | 54 |
| `notifications.ts` | the whole file (`notificationsInput`, `NOTIFICATION_POLICY_THRESHOLDS`; the app's own types are `feedClient.ts:126-128`) | 44 |
| `whitenoise.ts` | the whole file | 39 |
| `follow-status.ts`, `own-profiles.ts` | whole files | 22 |
| `feed.ts` | `shuffleInput`, `globalTrendingRankedEventsInput`, `recentNotesEventsInput`, `followingRepliesEventsInput`, `followingRecentEventsInput` (`:73-84`, `:99-120`, `:161-212`) | about 85 |
| `appview-social.ts` | `followStatusAppView`, `ownProfilesAppView`, `notificationsSeenAppView`, `dmConversationAppView` (`:79-145`) | about 65 |
| `dm.ts` | `dmEnvelopesInput`, `dmConversationInput` (`:22-46`) | about 25 |
| `profile-search.ts` | `profileSearchInput`, `profileEventsSearchInput` (`:29-44`) | about 16 |

What production uses from `nostr/recipes`: `naggFeedClient.ts:15-23` (eight names), `nagg-tier.ts` (six),
`recipes.VertexFailureSchema`, `recipes.profileAppView`, `recipes.profileSearchAppView`.

**Obligation today.** None on callers. On maintainers: these builders are kept type-correct and fixed with the rest
(`6f806693d` changed the replaceable tie-break inside the unused `wallpapers.ts`), and their tests are read as
"wire-contract" pins (pass 0 `nostr.md` row 5) although no request with those shapes is ever sent. the capability-cache item (since deleted) records the
capability cache's stale-request defect.

**Proposed shape.** Delete the rows above, the `index.ts` re-exports of the emptied files, and the schema block in
`schemas.ts`. Nothing replaces them.

**Deletion test.** Nothing is lost: no import, no request, no stored value.

**Deletes.** About 650 source lines and the tests that exercise only them: `nostr/__tests__/recipes-wallpapers.test.ts`
(73), the `capabilities` describe in `transport.test.ts` (`:34-71`), "the capability probe" in `wire-bounds.test.ts`
(`:71-110`), the matching cases in `recipes.test.ts` and `appview-social.test.ts`: about 250. Net down.

**Risk.** None stored or sent. One owner question: whether `nostr` is meant to stay a general nagg client library
(it was the separate `nagg-ts` package). It is private and consumed only here.

**Pins.** None needed: nothing behaves differently. `bun run type-check` and the nostr suite are the gate.

**Size.** M (twelve files, all deletions). Mechanical. the capability-cache item (since deleted) closes with it.

## 2. `HomeFeed` page 0 on `useCachedRead`, load-more on its own controller

Named by pass 2 (candidate 6); unchanged since: `HomeFeed.tsx` is the same 1,200 lines.

**Module and callers.** `app/features/feed/components/HomeFeed.tsx`: state and refs `:378-405`, `beginNetworkLoad`
`:407-419`, the trigger effect `:480-498`, `handleRefresh` `:500-504`, `loadFeedImpl` `:917-1081`,
`loadMoreItemsImpl` `:1083-1179`, the 22-field `HomeFeedLoadCtx` `:892-915`; `useFeedRetry.ts` (one caller);
`feedPagination.ts`. One mount (`FeedScreen`). The model is `UserFeed.tsx:531-598`, which already reads page 0
through `useCachedRead` over the same `feedPageCache`.

**Obligation today.**
- The component builds the same 22-field context twice (`:438-463` for page 0, `:510-535` for load-more) and lists
  ten dependencies for each; `loadFeedImpl` never reads `quotedRef`, `profilesRef`, `appendPage`; `loadMoreItemsImpl`
  never reads `isFirstRender`, `applyPage`, `resetContent`, `setIsLoading`, `setIsRefreshing`, `setLoadError`.
- Ordering rules the loader must remember: clear the retry timer, reset page status, abort, null the load id,
  dispose the client (`:952-957`); on a fresh cache hit abort and null the load id again (`:1005-1007`); clear
  `isRefreshing` on success and failure but not on the fresh-cache return (F185, pinned as a QUIRK at
  `homeFeedLoad.test.tsx:374`).
- One `activeLoadIdRef`/controller is shared by page 0, its enrichment, a stale revalidation and load-more, so
  load-more aborts page 0's enrichment (F221).
- `isLoading`/`loadError`/`isRefreshing` are derived three more times for logs (`:715`, `:734`, `:762-770`);
  `useCachedRead` already emits `read.<surface>.*` for the same transitions.

**Proposed shape.** Page 0: `useCachedRead({ store: feedPageCache, surface: 'homeFeed', key: feedPageKey(spec,
viewer), viewerKey, coldStart: 'skeleton', classify, fetcher })`, with `status`, `isFetching && mode === 'refresh'`
and `refresh()` replacing `isLoading`, `loadError`, `isRefreshing` and `handleRefresh`; one effect applies
`read.data` to the content state and the pagination cursor, as `UserFeed.tsx:559-598` does. Load-more keeps its own
small state (`idle | loading | retryAt(ms) | ended`) and its own `AbortController`; `useFeedRetry` creates its timer
inside (its only caller passes one it made for it). `useCachedRead` becomes the one owner of page-0 freshness, cold
start and supersession for both profile and home feeds. Pitfall: the facade pager that load-more continues lives in
the feed client (`facadeFeedClient.ts:153-167`), so the client must be owned by the component and shared by the
fetcher and load-more, not created and disposed per page as `fetchUserFeedPage` does.

**Deletion test.** Deleting `loadFeedImpl` and the flags loses nothing `useCachedRead` does not already do for
`UserFeed`: warm paint, fresh skip, stale revalidate, supersession by generation, refresh.

**Deletes.** `loadFeedImpl` (165), the context interface and the two literals (about 75), four state flags and five
refs with their resets (about 25), the trigger effect (19), the log-only phase derivations (about 20). Adds the read
call, the apply effect and the load-more state (about 80). Net about 150 down.

**Risk.** No saved data (`feed-page-cache` is `persist: false`, `feedCache.ts:13-20`), no wire change, no navigation.
Visible change: the refresh latch (F185) and the aborted enrichment (F221) go away; both are pinned as they are, so
those assertions flip on purpose. The preference-change reload (`:485-497`) needs a decision in the conversion:
`useFeedContentState.ts:123-124` already filters ignored people at render, so it can become a `refresh()` only when
the page is stale.

**Pins.** `app/features/feed/__tests__/homeFeedLoad.test.tsx` (8), `app/__tests__/HomeFeed.test.ts` (4, retry timer
and footer), `app/features/feed/__tests__/engagementRowRenders.test.tsx`, `feedPagination.test.ts`,
`useCachedRead.test.tsx`. Pin first: load-more during page 0's enrichment and during a stale revalidation;
refresh failure with rows on screen; a block while the page is fresh (rows vanish, no request).

**Size.** M (one large file, `useFeedRetry`, tests). Behaviour-preserving except the two flipped QUIRKs.

## 3. Facade `getOwnHistory` and `discoverMints`: tier-spanning reads with no caller

**Module.** `nostr/src/facade/data-layer.ts:141-149` (interface), `:296-357` (methods), `:1054-1080`
(`assembleOwnHistory`); `own-state.ts` (91); per tier: `nagg-tier.ts:283-308` (ownHistory), `:373-410`
(discoverMints); `primal/tier.ts:137-150`, `:224-245`; `primal/demux.ts:332-343`; `relay/tier.ts:219-271`;
`relay/demux.ts:219-231`; `mint-reviews.ts:54-101`, `:189-...` (`DiscoverMintsResponseSchema`), `:262-284`
(`discoverFromReviews`); `strategy.ts` (4 type lines). Callers: none. `grep '\.getOwnHistory(\|\.discoverMints('`
finds no production use of the facade methods; the app's `discoverMints` is `app/shared/lib/apiClient.ts:541`, a
separate fetch of the same `/nostr/mint/discover` route with its own parser.

**Obligation today.** Maintainers carry three tier adapters and a demux each for two reads, plus a second parser of
the mint-discovery response that can drift from `apiClient`'s. Own history is ADR 0003's intended seed for own
state (`app/docs/adr/0003-tiered-nostr-data-layer.md:60-61`); the app still seeds from the relay subscription in
`useOwnEventsSync`.

**Proposed shape.** Owner's choice: delete both (and amend ADR 0003's line), or wire `getOwnHistory` as the seed it
was designed to be. Deleting `discoverMints` from the facade is independent: the app has one working owner of that
route already (`apiClient.discoverMints`).

**Deletion test.** Nothing runs it, so nothing is lost today; a future own-state seed would have to be rebuilt.

**Deletes.** About 380 source lines; `nostr/__tests__/facade-own-state.test.ts` (97) and the discovery cases in
`facade-mint-reviews.test.ts` (about 50).

**Risk.** None sent or stored. The ADR is the only thing that changes meaning.

**Pins.** None needed for the deletion.

**Size.** M (eight files). Mechanical once the owner rules.

## 4. One signing tail, one `created_at` rule, one newest rule for own replaceable events

**Module.** `app/shared/lib/nostr/ownReplaceableEvent.ts` becomes the owner. Copies today:

- Sign and re-check: `moderation.ts:123-132` (mute), `:173-183` (report), `followSync.ts:356-369`,
  `publishOwnProfileMetadata.ts:247-253`. Each: build `NDKEvent` with kind, pubkey, `created_at`, tags, content;
  `event.sign(signer)`; `scope.check()`; `if (event.pubkey !== ownPubkey || ndk.signer !== signer) throw`.
- `created_at = max(now, base + 1)`: `moderation.ts:126`, `followSync.ts:359`, `publishOwnProfileMetadata.ts:42-45`
  (exported, one other caller: its test).
- Which replaceable stands: `nostr/src/replaceable.ts:12` (`supersedes`) is the owner, used by `followSync.ts:117`,
  `nostrSocialStore.ts:495`, `partitionOwnEvents.ts:104,109`, `useOwnEventsSync.ts:106`; re-written at
  `ownReplaceableEvent.ts:110-114`, `feed/lib/moderation.ts:13-19` (`isNewerMuteList`),
  `publishOwnProfileMetadata.ts:132-138` and `:154-159`.

**Obligation today.** Each writer must remember the pre-sign signer check, the post-sign pubkey/signer check and
the `+1` rule; one forgot the pre-sign check (mute and report: `matchingSigner` before the read, nothing before
`sign`); two (the relay-list writers) forgot all three (defect D3).

**Proposed shape.** `signOwnReplacement(ndk, signer, scope, { kind, tags, content, baseCreatedAt? })` returning the
signed event, and every newest comparison through `supersedes` (`isNewerMuteList` becomes `!current ||
supersedes(...)` on the mapped fields, or is deleted for `supersedes` directly).

**Deletion test.** The copies vanish into one call each; nothing reappears at callers.

**Deletes.** About 50 lines across four files, adds about 15. Net about 35 down.

**Risk.** Behaviour-preserving: adding the pre-sign signer check to the mute list and report changes only where they
refuse (before signing instead of after); both refuse and publish nothing in that case today. The relay-list writers
are not moved here (that changes `created_at` on the wire, D3).

**Pins.** `app/__tests__/moderationRelay.test.ts` (12, including "rejects stale-account signers", "chooses the lowest
ID for equal timestamps"), `followPublish.test.ts` (54), `publishOwnProfileMetadata.test.ts` (24, including "clamps a
future base"), `nostr/__tests__/wire-bounds.test.ts` "which of two replaceable events stands". Nothing to add.

**Size.** S. Mechanical.

## 5. Dead and unread parameters in the feed loaders

**Module.** `isFirstRender`: written, never read. `HomeFeed.tsx:401` (declared), `:447`, `:519` (passed), `:900`
(typed), `:971`, `:1009`, `:1043` (written); `UserFeed.tsx:517-518`, `:563`, `:587-589`, `:616`;
`app/features/feed/lib/loadUserFeed.ts:21`. No reader anywhere (`grep -rn isFirstRender app/features/feed`). The
comment at `UserFeed.tsx:517` ("skip fade-in for items after first render") describes a reader that no longer exists.
`UserFeedLoadCtx` (`loadUserFeed.ts:9-30`): `applyPage`, `resetContent`, `isFirstRender` are passed
(`UserFeed.tsx:616-623`) and never destructured by `loadMoreUserItemsImpl` (`:897-915`). `HomeFeedLoadCtx`: see
candidate 2.

**Obligation today.** Callers build, memoize (dependency lists `:626-637`) and pass fields nothing reads; a reader
assumes a first-render rule that is not there.

**Proposed shape.** Delete the ref, its writes and the three unused context fields. If candidate 2 lands first, the
HomeFeed half goes with it.

**Deletion test.** Nothing reads them; nothing is lost.

**Deletes.** About 35 lines.

**Risk.** None.

**Pins.** `loadUserFeed.test.ts`, `facadeUserFeed.test.ts`, `homeFeedLoad.test.tsx` already cover the paths.

**Size.** S. Mechanical.

## 6. One relay-list publish function

Named by pass 2 (candidate 3).

**Module and callers.** `useOwnRelayListSync.ts:95-110` (first run) and `SettingsNetworkScreen.tsx:54-82`
(`publishRelayList`, called once at `:187-190`). Both build a kind 10002 with `created_at = now`, publish
`all-settled`, then `markPublished(created)`. Neither pins the account or the signer, neither sets `event.pubkey`.

**Obligation today.** The screen carries Nostr publishing (event construction, relay targets, the store's
`markPublished`) beside its UI state (`setPublishing`, `setPublishMsg` passed in as a five-field context). The two
targets differ: `DEFAULT_RELAYS` versus own write relays plus defaults. At first run they are the same set unless the
person edited the list before discovery answered, which is defect D1.

**Proposed shape.** `publishOwnRelayList(ndk, pubkey, entries): ResultAsync<{ accepted: number }, ...>` in
`outbox/`, targeting own write relays plus defaults, with `captureProfile`/`matchingSigner` around it; both callers
call it; the screen keeps only its two UI flags. The F216 repair (mark published only the entries that were sent)
belongs inside it, but changes when `source` is saved as `relay`: that part is out of scope for this pass.

**Deletion test.** Removing `publishRelayList` from the screen loses nothing the shared function does not hold.

**Deletes.** About 45 lines, adds about 25.

**Risk.** Wire: the first-run target becomes own-write-plus-defaults, which equals `DEFAULT_RELAYS` on every path
except D1's. Saved data: none changed by the merge itself.

**Pins.** `app/__tests__/useOwnRelayListSync.test.tsx` (42, first-run publish to the default relays at `:400`).
**The Settings publish has no test.** Pin first: publish success marks published with the accepted count; failure
keeps `source: 'local'` and shows the message; relays targeted.

**Size.** S. Mechanical for the merge.

## 7. One post runner for the composer and the reply bar

Pass 2 candidate 10 (not converted in pass 2).

**Module and callers.** `PostComposer.tsx:84-164` (`runComposerPost`) and `ThreadReplyBar.tsx:192-232`
(`handlePost`). Both: re-entry guard on a ref plus a state flag, upload pending media through `uploadMediaBlocks`,
publish (`usePublishNote` / `publishComposed`), reset the guard, act on `'ok'`. The composer maps every outcome and
upload error to a message (`:73-79`, `:137-150`, `:163`); the reply bar discards both (`:213-217`, `:225`). Also
`if (!ndk?.signer) return 'no-key'` twice (`useComposerActions.ts:106`, `:199`) and the media-pending check twice
(`:107`, `:204-205`).

**Obligation today.** Each surface re-implements the guard, the upload error classification and the outcome
handling; they have drifted (F185, F204: failed replies are silent).

**Proposed shape.** `postDraft({ ndk, blocks, uploads, patchBlock, onProgress, publish }) → PostOutcome` (adding
`'upload-failed' | 'too-large' | 'canceled'` to `PublishOutcome`) next to `uploadMediaBlocks`, and one
`OUTCOME_MESSAGE` both surfaces show. The composer keeps navigation; the reply bar keeps clearing its text.

**Deletion test.** Deleting one copy loses only the drift.

**Deletes.** About 75 lines, adds about 35.

**Risk.** UI only: the reply bar starts showing the composer's messages (the F185/F204 repair for replies). The poll
half of F204 (reply tags) changes the wire and stays out.

**Pins.** `app/__tests__/composerPost.test.tsx`, `threadReplyPost.test.tsx` (pins the silence as a QUIRK, flips),
`publishComposed.test.ts`, `publishPoll.test.tsx`, `composerStore.test.ts`.

**Size.** S (three files). Mostly mechanical.

## 8. One "ask the indexers for my follow list"

**Module and callers.** `useOwnSocialGraphSeed.ts:24-66` (root layout, once per pubkey, resolves at the facade's
first paint) and `followSync.ts:249-284` (`askIndexers`, waits for every source to settle, then seeds). Both call
`layer.getSocialGraph({ pubkey })` and `seedFollowsFromFacade({ follows, createdAtSec: contactsUpdatedAt })`. A third
caller reads counts only (`fetchProfiles.ts:206-218`).

**Obligation today.** Two owners of "what do the indexers say my follow list is": one seeds early from a partial
answer and never retries (F203 item 3), one seeds late from a complete one.

**Proposed shape.** One `seedOwnFollows(pubkey) → IndexedList` in `followSync.ts`; the hook calls it (and retries on
the triggers the follow worker already has).

**Deletes.** About 40 lines, adds about 10.

**Risk.** Timing: the read-side seed lands when every source settled (up to the source timeout plus 5 s) instead of
at first paint; the saved `followingPubkeys` is written later. Not mechanical; pairs with F203's repair.

**Pins.** `ownSyncLifecycle.test.tsx` (seed once, QUIRK), `followPublish.test.ts` (ask-indexers paths).

**Size.** S.

## 9. One pay address for a Nostr person

**Module and callers.** `app/shared/lib/cashu/npc.ts:84-90` already has `npcAddressForPubkey` (used by
`Colada.tsx:544`, `SendScreen.tsx:313`). The area re-implements "validated lud16, else npub.cash" three times:
`useZap.ts:51-74` (inline encode-and-catch at `:59-65`, lower-cases at `:57`), `UserProfileScreen.tsx:1130-1137`
(`getNpcAddress(undefined, npub)`), `UserMessagesScreen.tsx:206-219` (inline encode-and-catch).

**Obligation today.** Each payer must validate `lud16` with `LightningAddress` and remember the fallback; one
lower-cases, two do not (pass 0 QUIRK).

**Proposed shape.** `payAddressFor(pubkey, lud16?)` beside `npcAddressForPubkey`; the three callers use it.

**Deletes.** About 25 lines, adds about 10.

**Risk.** Money: where a zap is sent. A behaviour-preserving merge keeps the zap's lower-casing at the zap caller;
choosing one rule is the owner's.

**Pins.** `app/__tests__/useZapStart.test.tsx` (lower-casing, fallback). Not pinned: the profile and DM Send targets.
Pin first: both, with an invalid and a mixed-case `lud16`.

**Size.** S. Mechanical except the case rule.

## 10. The replaceable-list owner

See the section above. Size M (five writers, two hooks). Not mechanical: it decides which relays receive kinds
10000, 0 and 10002 and when they wait. Do it with F227. Pins it would need first: mute publish relays when the relay
list changes during the read (`moderationRelay.test.ts` mocks `getOwnWriteRelays` and does not assert the publish
set); the kind 0 editor building on a partial read (D5); the Settings relay publish (none today).

## 11. Test-only and dead exports in the area

- `clearIgnoredFeedItems` (`app/features/feed/stores/ignoreStore.ts:36`, `:190`): no caller, not even a test.
  Pass 2 recommended deleting it in pass 3. It is an action, not a saved field.
- `decodeMuteList` (`moderation.ts:24`) exported for `moderationRelay.test.ts:287` only; its first check repeats
  `validOwnEvent`, which `readNewestOwnEvent` already applied to every event it returns (`ownReplaceableEvent.ts:109`).
  Keep the export if the test stays; drop the repeated check.
- `migrateNostrSocialStore` (`nostrSocialStore.ts:363`) is exported for its test only; leave (persist migrate).

About 10 lines. Size S. Mechanical.

## 12. Share route wrappers

`app/app/share.tsx:19-58` and `app/features/user/screens/ShareRoute.tsx:9-39` (re-exported by
`app/app/(user-flow)/share.tsx` and `(profile-flow)/share.tsx`): the same `useRouteParams(shareRouteParamsSchema(d))`,
the same `type` default, the same title state and `onTitleChange` callback, then different chrome. A
`useShareRoute(defaultType, where)` returning `{ parsed, type, title, onTitleChange }` removes about 15 lines.
Navigation risk only; `shareRouteParams.test.ts` pins the schema. Size S. Low value; listed so it is not re-surveyed.

Also looked at and left: the three FIFO seed maps (`threadSeedCache.ts`, `profileFeedSeedCache.ts`,
`imageAspectCache.ts`; a shared bounded map saves about 15 lines and none outlives an account switch differently);
the sync trigger hooks (`useFollowSync`, `useMuteListSync`, `useOwnRelayListSync`'s effect: different trigger sets,
a shared hook would be an option bag; `useMuteListSync` disappears with candidate 10 instead); `useThread` and the
profile settlement (pass 2 candidates 7 and 9, still state-machine work, F221); `nostrSocialStore` actions (every
action has one or two production callers); `publishEvent` (every caller passes `relays` and `resolveOn` with
different values; no parameter is uniform).

---

## Defects

Grepped `docs/follow-ups/` first. Not repeated: F185 (refresh latch, silent reply and vote), F204 (reply poll, silent
paging), F216 (Settings relay edit during publish; first-run on `null`), F221 (D5, D6, D8 of pass 2), F227 (the mute
list's old relay targeting; follows waiting), F239 (discovery waits on every default relay).

**D1. A relay edit made before the first-run publish is marked published and never sent.**
`useOwnRelayListSync.ts:95-110` publishes the defaults (`:100`) and then `markPublished` (`relayListStore.ts:146-148`)
sets `source: 'relay'` without looking at `entries`. Path: new account; open Settings → Network while discovery is
still waiting (the 1.5 s defer plus the read; with F239 a silent default relay keeps it waiting all session); add a
relay (entries `[]` become `[mine]`, `source: 'local'`); discovery answers "no list" and publishes the defaults. The
"Publish" button disappears, the device now writes to `[mine]` only (`getOwnWriteRelays`), the public list says the
defaults, and the next start ignores the relays' copy (`setFromRelay`, `:117`: same `created_at`, `source: 'relay'`).
F216 covers an edit during the Settings publish, not this path. Traced. Failing test (extend
`useOwnRelayListSync.test.tsx`): mount, `addRelay('wss://mine')` before the read resolves, every relay answers none,
expect `source === 'local'` or the published tags to include `wss://mine`. Repair touches saved `source` and what is
published.

**D2. After the first-run publish the relay list reads as empty, and adding one relay drops the defaults from the
public list.** Same `markPublished` (`relayListStore.ts:146-148`) leaves `entries: []` with `source: 'relay'`,
`hasPublished: true` (pinned as plain behaviour at `useOwnRelayListSync.test.tsx:411`, not marked QUIRK). The next
start fetches the same list and `setFromRelay` ignores it (equal `created_at`). Network settings shows no relays;
`addRelay` upserts onto `[]` (`:122-129`), so the list becomes `[mine]`, and "Publish relay list" sends a kind 10002
with one relay, replacing the defaults the account published. Pass 2's survey traced the first half (candidate 3);
it was not carried into F216. Failing test: run the first-run publish, then `addRelay(x)`, expect `entries` to hold
the defaults and `x`. Repair writes saved `entries`.

**D3. "Publish relay list" can be ignored by every relay while the app records it as published.**
`SettingsNetworkScreen.tsx:65` dates the event `now`; the other three replaceable writers use `max(now, base + 1)`
because relays keep the newer one (`publishOwnProfileMetadata.ts:38-41`). `setFromRelay` takes a list dated in the
future (no check, `relayListStore.ts:115-120`), and the first-run publish and a quick Settings publish can share a
second. Path: another client with a fast clock published the account's 10002 a few minutes ahead; edit a relay here
and publish; relays keep the other list (newer `created_at`), `publishEvent` still reports acceptance, `markPublished`
lowers `updatedAt` to `now`, and the next sync replaces the local edit with the other list. Traced, relay behaviour
per NIP-01 not run. Failing test: store `updatedAt = now + 600`, publish from Settings, expect `created_at >
updatedAt`. Repair changes `created_at` on the wire.

**D4. Removing every relay and publishing sends an empty relay list, while the app keeps writing to the defaults.**
`relayListStore.ts:173-177` reads `entries: []` as "use `DEFAULT_RELAYS`"; `SettingsNetworkScreen.tsx:69` serializes
`[]` as a kind 10002 with no tags and publishes it (Publish is shown for any `source: 'local'`, `:171`). Other
clients then find no outbox relays for the account, while this phone posts to the defaults. One value with two
meanings. Traced. Failing test: `removeRelay` every entry, publish, expect either no publish or the defaults in the
tags. Repair changes what is published.

**D5. A profile edit can be built on an older profile when a relay has not answered.**
`publishOwnProfileMetadata.ts:113-125`: on the 3 s timeout or a partial EOSE, `finish()` returns `found` with the
newest event seen so far; `:212-217` uses it as the base, `applyProfilePatch` keeps every other field from it, and the
new event (`created_at = base + 1` or later) replaces the newer profile everywhere it lands. The local `latest` wins
only when it is newer (`:150-160`). Path: the profile was edited on another client to relays this phone reads slowly;
edit the name here within 3 s of the read; the other client's fields (lud16, about, picture) revert. This is the rule
pass 2 fixed for follows (build only on a complete read). The pinned "does not classify partial-eose as no kind-0"
case (`publishOwnProfileMetadata.test.ts:337`) has no event, so it does not cover this. Traced. Failing test: one
relay emits an older kind 0 and EOSE, the other never answers; expect `base-unavailable`, not a publish. Repair
changes what is published.

---

## Not read

- `nostr/src`: `envelope.ts`, `map/feed.ts`, `facade/relay/for-you/*`, `facade/session/notifications-merger.ts`,
  `facade/thread.ts`, `tiers/*`, `primal/protocol.ts`, `relay/protocol.ts`, `relay/socket-pool.ts` were not read for
  this pass beyond the export grep. `data-layer.ts` was read at the interface and the two unused methods only.
- `useThread.ts`, `useNotificationsPage.ts`, `NotificationsScreen.tsx`, `ThreadView.tsx`, `ContactsScreen.tsx`,
  `UserProfileScreen.tsx` (beyond Send Money and follow), `UserMessagesScreen.tsx` (beyond the pay target), the
  image overlay, `PostCard`, `NoteContent`, `StoriesCarousel`.
- `app/shared/lib/nostr`: `secureStorage.ts`, `derivationIntegrity.ts`, `accountIntegrity.ts`, `loadAccountKeys.ts`,
  `keyDerivation.ts`, `nip17.ts`, `sendDirectMessage.ts`, `publishGiftWrappedDM.ts`, `media/*`, `fetchProfiles.ts`
  and `useEntityCache.ts` beyond the social-graph call, `searchProfiles.ts`, `buildNostrDataLayer.ts` beyond its
  `createNostrDataLayer` call.
- NDK internals: only the default signature validation ratio was checked (`initialValidationRatio = 1`, so NDK
  verifies every event's signature unless the app lowers it; it does not).
- The export grep matches names as words; a name used only through a dynamic key or a string would be missed. None
  was found by a follow-up grep of the ten largest.
- No test was run, nothing on a device, no relay contacted.
