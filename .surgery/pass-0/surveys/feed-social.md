# Survey: feed / composer / contacts / user / profile-switch (pass 0)

Area: `app/features/{feed,composer,contacts,user}`, `app/shared/lib/profile/*`,
`app/shared/lib/{profile,identity,contactSearch,username}.ts`, and the routes that host them.
All paths below are relative to `app/` unless they start with `/`. Tests live in `app/__tests__/`
unless a folder is given. Read only; no test was run.

Method: mapped every source module in the area to the test files that import it (real import
versus `jest.mock`), then read the money, key, saved-data and publish paths end to end. Sizes:
feed 26.4k lines, composer 1.9k, contacts 1.2k, user 3.1k, shared/lib/profile 2.0k.

---

## 1 + 2. Boundaries, and whether each is pinned

### Saved data (AsyncStorage / SecureStore / SQLite / files)

| # | Boundary | File | Used by | Pinned by |
|---|---|---|---|---|
| S1 | `feed-ignore-store` (profile scope): `ignoredPubkeys`, `ignoredEventIds`, `muteList`, `blockOverrides`, `dmFilterEnabled`, `dmFilterWords`; schema `PersistedFeedIgnoreStore` | `features/feed/stores/ignoreStore.ts:84-207` | feed, thread, DM screen, settings moderation, `shared/lib/nostr/moderation` | `feedIgnoreStorePersisted.test.ts` (read-back, bad entry dropped, unreadable mute list, upper-case ids), `feedPreferenceStores.test.ts`, `moderationStore.test.ts`, `moderationRelay.test.ts`. PINNED. Not pinned: `dmFilterWords` over 100 entries or a word over 100 chars fails the whole blob (no `.catch`), `clearIgnoredFeedItems` |
| S2 | `notification-policy-store` (profile scope): `policy`, `replyScope` | `features/feed/stores/notificationPolicyStore.ts:33-80` | NotificationsScreen, settings | `feedPreferenceStores.test.ts`, `releaseUpgrade.test.ts`, `persistedEnumTolerance.test.ts`. PINNED |
| S3 | `own-profile-stats-cache` (global, persisted query cache, host scoped) | `shared/lib/profile/ownProfileStatsStore.ts:14` | `ownProfileSync`, drawer/profile header | NONE for this store's key or shape (`ownProfileSync` is only ever mocked) |
| S4 | Hand-written `profile-store` blob `{state:{activeAccountIndex,profiles},version}` written straight to AsyncStorage, bypassing the store's `partialize` | `shared/lib/profile/profileTransition.ts:121-139` (`persistSwitchTargetToDisk`) | every switch/create/import flow | `profileSwitchOrdering.test.ts` (asserts the write, disk-full, never-answers), `inProcessProfileSwitch.test.ts`. PINNED for ordering; the blob shape is asserted only as `state.activeAccountIndex` |
| S5 | Second hand-written `profile-store` blob on profile removal | `shared/lib/profile/profileRemovalStorage.ts:344-369` | profile removal sheet | `removeProfile.test.ts:270`. PINNED |
| S6 | Third hand-written `profile-store` blob (`profiles: []`) plus hand-written `wallet-lifecycle` blob (6 fields) plus `settings` blob during recovery | `shared/lib/profile/profileSessionOrchestrator.ts:534-568` | key recovery screen, AppGate | `appGateRecoverySession.test.ts`, `keyRecoveryScreen.test.tsx`. PINNED |
| S7 | Transition guard key `profile-transition-in-progress` `{startedAt}`, 10 s expiry | `shared/lib/profile/profileTransition.ts:32-85` | all account flows, startup | `profileTransitionLock.test.ts`. PINNED |
| S8 | Profile removal: wallet SQLite inspection (read-only, `terminalStates`, `knownTables`), deletion plan (AsyncStorage keys, query caches, `nostr[-N]` db files, SecureStore, bunker secrets, `coco[-N].db`) | `shared/lib/profile/profileRemovalStorage.ts:89-373`, `removeProfile.ts:17-76` | settings profile removal | `removeProfile.test.ts`, `deleteNostrCaches.test.ts`. PINNED (mocks are of native modules, not of own collaborators) |
| S9 | `deleteAllProfiles` (nuclear wipe order: secure reset plan, forget dbs, Coco reset, SecureStore, whitenoise, nostr caches, `AsyncStorage.clear`) | `profileSessionOrchestrator.ts:590-683` | settings | `accountIntegrityBoundaries.test.ts`, `designSystemPrompts.test.tsx` (mostly mocked). PARTLY: I did not find a test asserting the order or the "erasing" hold branch; UNVERIFIED |
| S10 | In-memory session caches (not persisted): `feed-page-cache`, `notifications-page-cache`, `notification-followers-page-cache`, `search-posts-cache`; module `Map`s `threadSeedCache`, `profileFeedSeedCache`, `notificationFollowersSeedCache`, `imageAspectCache` | `features/feed/data/*Cache.ts`, `features/feed/lib/*SeedCache.ts`, `features/contacts/data/searchPostsCache.ts` | feed, thread, profile, notifications, search | `profileFeedSeedCache.test.ts`, `useThread.test.ts` (thread seed), `useNotificationsPage.test.tsx` (two caches). `notificationFollowersSeedCache`, `searchPostsCache`, `imageAspectCache`: NONE |
| S11 | `composerStore` (session, deliberately not persisted; `open()` resets draft) | `features/composer/state/composerStore.ts` | FAB, quote, ThreadReplyBar, PostComposer | NONE (only reached through mocks) |

### Wire formats (Nostr events and HTTP)

| # | Boundary | File | Pinned by |
|---|---|---|---|
| W1 | kind:1 note build: inline media urls, `imeta`, NIP-10 `e` root/reply markers, `q` + inline `nostr:nevent`, `p` dedupe, `content-warning` | `features/composer/publish/buildNoteEvent.ts:48` | `composerCore.test.ts`. PINNED |
| W2 | `publishComposed` (sign, optimistic own-content record, owned-blob record, publish, rollback) | `features/composer/publish/useComposerActions.ts:105-192` | `publishComposed.test.ts`. PINNED (owned-blob recording not asserted) |
| W3 | `usePublishNote` / `publishPoll`: kind:1068 publish, `poll-invalid`, store close on ok | `useComposerActions.ts:51-91,195-218` | NONE |
| W4 | kind:1068 poll and kind:1018 vote build; poll parse and tally | `features/feed/components/nostr/poll/{buildPollEvents,pollParse}.ts` | `pollCore.test.ts`. PINNED |
| W5 | Vote publish from the card | `poll/PollCard.tsx:67-88` | `PollCard.test.tsx` covers cell recycling only; the publish result is NOT pinned |
| W6 | Like / repost (kind 7 / 6) publish and kind:5 retraction, optimistic overlay settle | `features/feed/hooks/useNostrEngagement.ts`, `lib/engagementToggle.ts`, `lib/engagementOverlay.ts` | `engagementBehaviour.test.tsx`, `engagementToggle.test.ts`, `engagementOverlay.test.ts`. PINNED |
| W7 | Own-post delete: BUD-11 blob deletes then kind:5 `[['e',id],['k','1']]` to every relay in the list | `features/feed/hooks/useDeletePost.ts:46-210` | `executeDeletePost.test.ts`. PINNED (the `k` tag value and the empty relay list fallback are not asserted; UNVERIFIED) |
| W8 | Zap start: recipient resolution (validated, lower-cased `lud16`, else npub.cash), `clearPaymentContext` then `registerPendingZap`, `machine.enterAmount` / `startSendEcash` | `features/feed/hooks/useZap.ts:51-213` | NONE. Only `jest.mock`ed; `paymentRootContext.test.ts` is a source scan for the clear call, `pendingZapStore.test.ts` pins the store, not this caller |
| W9 | Reports (kind 1984 tags) and block/unblock menus | `features/feed/lib/moderation.ts` (`reportTags`, `changeMute`, `reconcileBlockedPeople`), `hooks/useModerationActions.ts` | lib: `moderation.test.ts`, `moderationThread.test.ts`. PINNED. Hook: NONE (mocked only) |
| W10 | DM send (NIP-17 gift wrap pair and self copy, NIP-04), echo reconciliation, blocked and mock short-circuits | `features/user/screens/UserMessagesScreen.tsx:334-470` | `userMessagesDmEcho.test.tsx` (echo, cross-protocol, cross-profile). Send failure paths and NIP-04 path: not pinned |
| W11 | Feed / thread / notifications reads through nagg and the tier facade | `features/feed/data/{feedClient,naggFeedClient,facadeFeedClient,facade*Adapter,mapNaggFeedPage,feedPagination}.ts` | `naggFeedClient.test.ts`, `facadeFeedClient.test.ts`, `facadeUserFeed.test.ts`, `facadeFeedAdapter.test.ts`, `facadeThreadAdapter.test.ts`, `facadeNotificationsAdapter.test.ts`, `mapNaggFeedPage.test.ts`, `feedPagination.test.ts`. PINNED (memory notes an 8-failure baseline in `naggFeedClient.test.ts`; not re-checked) |
| W12 | Own profile sync (`/nostr/profile` per own account, writes profileStore metadata and S3) | `shared/lib/profile/ownProfileSync.ts:16` | NONE (mocked in `accountIntegrityStartup.test.tsx`, `nostrKeysImportedFallback.test.tsx`) |

### Deep links and route params

| # | Boundary | File | Pinned by |
|---|---|---|---|
| R1 | `shareRouteParamsSchema` (type allowlist plus per-type shape check on `data`; documented as a security boundary) | `features/user/lib/shareRouteParams.ts:19` used by `app/share.tsx`, `features/user/screens/ShareRoute.tsx` (two route groups) | NONE in Jest. One e2e story (`e2e/stories/library/show-a-contacts-public-key.json`) enters the page |
| R2 | `UserMessagesRoute` params `{pubkey: Hex64, protocol: 'nip04'|'nip17' default 'nip17'}` | `features/user/screens/UserMessagesRoute.tsx:24` (3 route files) | NONE |
| R3 | Thread, profile, stories, composer, notifications, followers, feed, contacts routes | `app/(user-flow)/thread.tsx`, `app/(user-flow)/profile.tsx`, `app/(profile-flow)/profile.tsx`, `app/(stories-flow)/stories.tsx`, `app/composer.tsx`, `app/(drawer)/(tabs)/{feed,notifications,contacts}` | `threadNavigation.test.tsx` (ThreadScreen), `userProfileIdentityRow.test.tsx` (identity row only). Others NONE |

### Account flows (keys, irreversible)

| # | Boundary | File | Pinned by |
|---|---|---|---|
| A1 | `switchToExistingProfile` (integrity gate, lock, restart or in-process) | `profileSessionOrchestrator.ts:105` | `profileSwitchOrdering.test.ts`, `accountIntegrityBoundaries.test.ts`, `inProcessProfileSwitch.test.ts`. PINNED |
| A2 | `createAndSwitchProfile` | `:281` | `profileSwitchOrdering.test.ts`, `profileStoreCapacity.test.ts`. PINNED |
| A3 | `importAndSwitchProfile` (result union `switching|exists|busy|key-not-stored|key-mismatch|limit`) | `:376` | `accountIntegrityBoundaries.test.ts`, `nip46SwitchProfileAndPair.test.ts` (mocked). PARTLY: `limit` leaving the nsec stored is documented but I found no assertion; UNVERIFIED |
| A4 | `recoverMnemonicSession` | `:439` | `appGateRecoverySession.test.ts`, `appGateReinstallDetection.test.tsx`. PINNED |
| A5 | `runInProcessProfileSwitch`, `holdProfileSwitchForRestart`, `checkProfileSwitchLeaks` | `inProcessProfileSwitch.ts` | `inProcessProfileSwitch.test.ts`, `releaseFixtures.test.ts`. PINNED |
| A6 | `acquireTransition` lock, `cleanupCocoWithTimeout`, `activateProfileInMemory` | `profileTransition.ts` | `profileTransitionLock.test.ts`. PINNED |
| A7 | `showMnemonicRecovery`, `showNsecRecovery` forms | `keyRecovery.ts` | `keyRecoveryScreen.test.tsx`, `accountMismatchScreen.test.tsx`. PINNED |
| A8 | `profileSwitchResource`, `resetProfileNavigation`, `hasPresentedRoutes`, `joinOrStart`, `restartApp`, `resolveProfileTier` | small files in `shared/lib/profile/` | `profileSwitchResource.test.ts`, `suspendHelpers.test.ts`, `profileTier.test.ts`, appRestart via several. PINNED. `settleWithin`: only indirectly |

### Pure helpers and hooks used outside the area

| # | Boundary | File | Pinned by |
|---|---|---|---|
| H1 | `getUsername(seed)` deterministic word pair | `shared/lib/username.ts:862` | `usernameCompatibility.test.ts` (fixed vectors plus 4096-entry hash), `keyDerivation.test.ts`. PINNED |
| H2 | `resolveIdentityName` 8-step precedence | `shared/lib/identity.ts:79` (used across send, DM, drawer, zap, AI) | NONE. Seven test files mock it; none calls the real one |
| H3 | `CONTACT_SEARCH_MIN_LENGTH = 3` | `shared/lib/contactSearch.ts` | none needed (constant) |
| H4 | `useThread` | `features/feed/hooks/useThread.ts` | `features/feed/__tests__/useThread.test.ts` (4 cases: seed, Strict Mode, cache, unusable handoff). Load-more, reply sort change, spam audit promotion: NOT pinned. `threadItems.test.ts`, `buildThreadStructure.test.ts` pin the pure parts |
| H5 | `useNotificationsPage`, `notificationGroups`, `notificationResults`, `appNotificationRows` | `features/feed/hooks`, `lib` | `useNotificationsPage.test.tsx` and one test per lib. PINNED |
| H6 | `HomeFeed` load / refresh / load-more state | `features/feed/components/HomeFeed.tsx:917-1183` | NONE for the loader. `HomeFeed.test.ts` pins only the retry timer and footer copy; `engagementRowRenders.test.tsx` pins render counts |
| H7 | `UserFeed`, `loadUserFeed` | `features/feed/components/UserFeed.tsx`, `lib/loadUserFeed.ts` | `loadUserFeed.test.ts`, `facadeUserFeed.test.ts`. Component itself: mocked only |
| H8 | `useOverlaidContactSearch`, `useAllSearchResults`, `matchTiers`, `parseGeohashQuery`, `navigateToProfile` | `features/contacts/` | `vertexSearch.test.tsx` (first only). Others NONE |
| H9 | `sendMessageRecommendation`, `SendMessageMenu`, `ModeratedDmBubble` | `features/user/` | own tests. PINNED |
| H10 | `usePostActions` (post menu: share, hide, block, report, delete confirm) | `features/feed/hooks/usePostActions.ts` | NONE (mocked only) |
| H11 | `mergeRailCapabilities` / compose config | `features/composer/config/` | `composerCore.test.ts`. PINNED |
| H12 | `PostComposer` post flow (`runComposerPost`), `ThreadReplyBar.handlePost` | `features/composer/ui/PostComposer.tsx:84-164`, `features/feed/components/ThreadReplyBar.tsx:192-232` | NONE (both mocked wherever they appear) |
| H13 | Image overlay provider pure parts, stories carousel, NoteContent, relay card, metrics footer, card props | `features/feed/components/nostr/**` | own tests exist for pure parts (`imageOverlay*.test.ts`, `StoriesCarousel.test.tsx`, `NoteContent.test.tsx`, `metricsFooter.test.tsx`, `feedPostCardProps.test.ts`, `repostCardProps.test.ts`). `AnimatedImageOverlay`, `BottomPanel`, `videoLayout`, `useVideoOverlayNavigation`: NONE |

Count: 44 boundaries listed. Pinned 25, partly pinned 6 (S9, A3, W2, W5, W7, W10), unpinned 13
(S3, S11, W3, W8, W12, R1, R2, H2, H6, H10, H12, the hook half of W9, most of H8).

---

## 3. Likely surgery targets

1. **Three hand-built `profile-store` envelopes.** `profileTransition.ts:123-129`,
   `profileRemovalStorage.ts:354-360`, `profileSessionOrchestrator.ts:548-551`, each writing
   `{state:{activeAccountIndex,profiles},version}` beside the store's own `partialize`
   (`shared/stores/global/profileStore.ts:349`). A pass that adds a persisted field to
   `profileStore` must change four places or the three side writers silently drop it. The same
   file hand-writes the `wallet-lifecycle` blob (six fields, `:534-544`). Pinned: ordering and
   failure handling yes; "the side writers produce exactly what `partialize` produces" no.

2. **`HomeFeed` loader state machine.** `HomeFeed.tsx:378-405` and `:917-1183`. Flags that jointly
   encode the phase: `isLoading`, `isRefreshing`, `isLoadingMore`, `loadError`,
   `pageStatus.retryAfterMs`, plus refs `loadingMoreRef`, `activeLoadIdRef`,
   `activeAbortControllerRef`, `isFirstRender`, `paginationRef`, `feedItemIdsRef`; a 22-field
   context object is passed to two module-scope functions. Not pinned at all (see defect D2).

3. **`useThread`.** `useThread.ts:135-172`: `isLoading`, `isFetching`, `isLoadingMoreReplies`,
   `hasMoreReplies`, `error`, `dataVersion` and thirteen refs (`hasMoreRepliesRef` mirrors the
   state, `serverHasMoreRef`, `allSortedReplyIdsRef`, `spamAuditStartedRef`,
   `requestGenerationRef`, ...). Pinned: first paint from seed, Strict Mode, error exit. Not
   pinned: memory-first load-more, server continuation, sort change, audit promotion of OP replies.

4. **Post flow duplicated in two components.** `PostComposer.runComposerPost`
   (`PostComposer.tsx:84-164`: `busy`, `error`, `postProgress`, `postingRef`) and
   `ThreadReplyBar.handlePost` (`ThreadReplyBar.tsx:192-232`: `posting`, `postingRef`). Same
   upload-then-publish sequence, different failure handling (see D3). Neither pinned.

5. **`usePublishNote` forks into `publishPoll` and `publishComposed`.**
   `useComposerActions.ts:51-91` versus `:105-192`. Two publish paths with different relay
   routing (`all-settled` to own relays versus optimistic with outbox), different bookkeeping
   (poll records no own content, no popup) and different handling of `target` (see D1). The
   poll path is unpinned.

6. **Recipient resolution written three times.** `useZap.ts:51-74`,
   `UserProfileScreen.tsx:1218-1225`, `UserMessagesScreen.tsx` (`sendMoneyTarget`). All implement
   "validated `lud16`, else `<npub>@npub.cash`"; only `useZap` lower-cases the address (QUIRK).
   This decides who gets paid. None of the three is pinned.

7. **Module-level FIFO maps.** `threadSeedCache.ts`, `profileFeedSeedCache.ts`,
   `imageAspectCache.ts` repeat the same delete-and-reinsert eviction;
   `notificationFollowersSeedCache.ts` has no cap (a seed that is never taken stays for the
   process lifetime). None is registered with the account registry, so they outlive an in-process
   profile switch. Partly pinned (S10).

8. **`ignoreStore` block state.** `ignoreStore.ts:117-170`: `ignoredPubkeys`, `muteList`,
   `blockOverrides` jointly encode "blocked locally / published / pending sync";
   `clearIgnoredFeedItems` (`:190`, no caller outside tests) clears two of the four lists and
   leaves `blockOverrides` and `muteList`, so the next `receiveMuteList` re-adds every
   overridden block. Reconciliation is pinned by `moderationStore.test.ts`; the clear is not.

9. **`useNostrEngagement` module state.** `useNostrEngagement.ts:35` `reconcilingActions` (module
   `Set`) plus the three optimistic maps in `nostrSocialStore`. Already close to explicit and
   well pinned; listed because the module set is not account-scoped.

10. **Share route wrappers.** `app/share.tsx` and `features/user/screens/ShareRoute.tsx` are two
    near-identical wrappers over `ShareScreen` differing in default type and chrome;
    `ShareScreen` keeps a `selectedTab` string beside `type` and re-derives config in three
    places (`ShareScreen.tsx:92-136`). Unpinned.

---

## 4. Obvious defects

**D1. A poll written as a reply is published with no link to the post it replies to.**
`features/composer/publish/useComposerActions.ts:62-76` with `features/feed/components/ThreadReplyBar.tsx:442`
(`thread-reply-add-poll` calls `expandToFull(true)`).
Trigger: open a thread, tap the poll button in the reply bar, fill in the poll, Post. The composer
shows the reply context (`PostComposer.tsx:240`), but `publishPoll` passes only a `quote` reference
to `buildPollEvent` and ignores `target.mode === 'reply'`, so the kind:1068 goes out with no `e`
or `p` tag for the parent. Result: a top-level poll that never appears in the thread.
Expected: the poll carries the reply markers, or the reply bar does not offer a poll.
Second effect on the same path: if the reply bar held images, `expandToFull` copies them into the
draft; `runComposerPost` uploads them, then `publishPoll` drops them (question is text blocks
only) and nothing records the uploaded blobs, so they are orphaned on the media host.
A fix that adds tags changes a wire format: REPORT ONLY. Verified by reading both files and
`buildPollEvents.ts:22-46`.

**D2. Pull-to-refresh can stay "refreshing" with pagination and further refreshes blocked.**
`features/feed/components/HomeFeed.tsx:1001-1009` (fresh-cache early return) with `:500-504` and
`:559-562`.
Trigger: pull to refresh on one feed tab and, before it answers, switch to another tab whose
page was loaded in the last two minutes. `loadFeedImpl` for the new tab cancels the refresh
(`activeLoadIdRef.current = null`), paints from the fresh cache entry and returns without
calling `setIsRefreshing(false)` (only the network success and failure branches do, `:1041`,
`:1075`). `HomeFeed` is not remounted on a tab change (`FeedScreen.tsx:173`). While it stays
true: the spinner shows, `handleRefresh` returns early and `handleEndReached` returns early, so
the list cannot refresh or load more until some other event forces a network load.
The same early return also leaves `loadError` as it was (only `:1039` clears it), which is visible
when the cached page has no rows (error empty state instead of the empty one).
Expected: the early return settles `isRefreshing` and `loadError`. No stored data or wire format
involved. Verified by reading; not reproduced on a device.

**D3. A failed reply from the thread reply bar says nothing.**
`features/feed/components/ThreadReplyBar.tsx:213-217` and `:220-230`.
Trigger: post a reply when the image upload fails, the signer is missing, signing fails or no
relay accepts. The upload `catch` discards the error and `outcome` is acted on only when `'ok'`;
`publishComposed` itself only logs on failure (`useComposerActions.ts:142-149,180-184`). The
button re-enables and the text stays, with no message. The full composer shows a message for
each of these (`PostComposer.tsx:73-79,137-150,163`).
Expected: the same error surfaced. No stored data or wire format involved. Verified by reading.

**D4. A failed poll vote is treated as done.**
`features/feed/components/nostr/poll/PollCard.tsx:81-88`.
Trigger: vote when no relay accepts (or signing fails inside the publish seam). The
`publishEvent` result is not read; the pending marker clears and nothing is shown. The card
only flips to results when the subscription sees the vote, so the user sees an unchanged card
and no error.
Expected: an error on `isErr()`. No stored data or wire format involved. Verified by reading
the card; I did not read `publishEvent` beyond its call sites returning a Result elsewhere in
the area.

**D5 (UNVERIFIED). A zap that fails to start is only logged.**
`features/feed/hooks/useZap.ts:147-163,186-196`.
`startPresetZap` / `startCustomZap` register the pending zap, then catch a throw from
`machine.enterAmount` / `machine.startSendEcash` and only log. If the machine itself shows no
message on that failure the tap does nothing visible and the pending-zap record stays until the
next root-entry clear. I did not read the machine (`wallet/react`, another area) to confirm
whether it surfaces its own error.

**D6 (UNVERIFIED). The composer can stay on "Posting…" if `publish()` throws.**
`features/composer/ui/PostComposer.tsx:156-158`: `postingRef`/`busy` are reset only after
`await publish()` returns; there is no `try/finally`. Every failure I traced returns an outcome
rather than throwing, so I could not name an input that throws; Cancel still leaves the screen.

Not defects, noted as QUIRKs for the tests below: `importAndSwitchProfile` returning `limit`
leaves the imported nsec in SecureStore (documented at `profileSessionOrchestrator.ts:367`);
`dmFilterWords` has no per-entry tolerance; `useZap` lower-cases `lud16` and the other two
callers do not; `shareRouteParamsSchema` validates the secondary `npub` / `lud16` params by shape
only, with no tie to `data`.

---

## 5. Proposed characterization tests (ranked)

1. **Zap start** (`useZap`), new `app/__tests__/useZapStart.test.tsx`. Pin: valid `lud16` wins and
   is lower-cased (QUIRK); invalid `lud16` falls back to `<npub>@npub.cash`; no selected mint
   shows "Add a mint" and registers nothing; `clearPaymentContext('feed.zap_post')` runs before
   `registerPendingZap`; the registered record carries `eventId`, `authorPubkey`, `baseSats`,
   `presetSats`, `comment`; `enterAmount` receives `{value: preset.sats, unit:'sat'}`, the
   selected mint and `destination:'meltQuote'`; a throwing machine leaves the record registered
   and shows nothing (QUIRK). Breaks if: the two calls are swapped, the `LightningAddress` check
   is removed, or `preset.sats` is replaced by `baseSats`.

2. **Share route params** (`shareRouteParamsSchema`), new `app/__tests__/shareRouteParams.test.ts`.
   Pin: `type` outside the four values rejected; missing `type` takes the route default; `p2pk`
   needs a compressed pubkey, `lud16` an address, `npub`/`profile` an npub or 64-hex; `data` over
   512 chars rejected; a `lud16` address under `type=npub` rejected; mismatched secondary `npub`
   accepted (QUIRK). Breaks if: the `superRefine` is removed or the enum widened.

3. **Poll publish path** (`usePublishNote` with a poll), extend `app/__tests__/publishComposed.test.ts`
   or new `publishPoll.test.ts`. Pin: fewer than two labelled options or empty question gives
   `poll-invalid` and publishes nothing; a pending media block gives `media-pending`; quote
   target adds `q` and `p`; reply target adds no reply tags (QUIRK, D1); media blocks are left
   out (QUIRK); `relays` are the own write relays with `resolveOn:'all-settled'`; store closes
   only on ok; no own-content record (QUIRK). Breaks if: the `options.length < 2` guard is
   dropped or `close()` moves before the publish.

4. **HomeFeed loader**, new `app/features/feed/__tests__/homeFeedLoad.test.tsx` driving
   `HomeFeed` with a fake `getFeedClient` (as `engagementRowRenders.test.tsx` already mounts it).
   Pin: cold load shows skeleton then rows; a fresh cache entry paints without a network call; a
   stale one paints then revalidates; failure with no rows shows the error empty state; a
   superseded load never applies; refresh keeps rows; refresh then tab switch to a fresh tab
   leaves `refreshing` true (QUIRK, D2). Breaks if: the `isActiveLoad` check is removed or the
   cache key loses the viewer pubkey.

5. **`profile-store` side writers agree with the store**, new
   `app/__tests__/profileStoreSideWriters.test.ts`. Pin: after `persistSwitchTargetToDisk(n)`,
   after the removal step "profile list", and after onboarding recovery, the AsyncStorage value
   parses with the store's persisted schema, has exactly the keys `partialize` produces and
   `version === PROFILE_STORE_PERSIST_VERSION`; every `ProfileEntry` field (`source`,
   `walletPhraseFingerprint`, metadata) survives a switch write. Breaks if: a field is added to
   `partialize` and not to a side writer, or a side writer maps `profiles` lossily.

6. **`resolveIdentityName` precedence**, new `app/__tests__/identityName.test.ts`. Pin the eight
   steps in order, trimming, `display_name` beating `displayName` (QUIRK), whitespace-only values
   skipped, `pubkey` beating `fallbackName`, `'Unknown'` last, NIP-05 never used. Breaks if: any
   two branches are swapped.

7. **Reply bar and composer post flows**, new `app/features/feed/__tests__/threadReplyPost.test.tsx`
   and `app/__tests__/composerPost.test.tsx`. Pin: double tap publishes once; upload failure
   publishes nothing and re-enables; ok clears text and media; non-ok keeps the draft; composer
   shows the `OUTCOME_MESSAGE` text, reply bar shows nothing (QUIRK, D3); `expandToFull` moves
   text and media into the store and clears the bar. Breaks if: `postingRef` is removed or the
   draft is cleared before the outcome.

8. **`useThread` paging**, extend `app/features/feed/__tests__/useThread.test.ts`. Pin: load-more
   reveals the next 10 ids from `allSortedReplyIds` with no network call; `hasMoreReplies` turns
   false when the stack is exhausted and `serverHasMoreReplies` is false; a server continuation
   fetches with `offset = stack length` and appends only unseen ids; a sort change restarts from
   offset 0; a load-more error leaves `hasMoreReplies` true and shows no error (QUIRK); OP replies
   found by the audit are inserted after the leading OP block. Breaks if: `THREAD_REPLY_PAGE_SIZE`
   slicing uses the wrong start, or the generation guard is removed.

---

## 6. Not examined

- Read only by outline or grep, not line by line: `NotificationsScreen.tsx` (1359),
  `NotificationFollowersScreen.tsx`, `UserFeed.tsx` (1057), `ThreadView.tsx` (928),
  `UserProfileScreen.tsx` apart from send-money and its state hooks, `ContactsScreen.tsx`,
  `StoriesCarousel.tsx`, `StoriesScreen.tsx`, `PostCard.tsx`, `NoteContent.tsx`,
  `MetricsFooter.tsx`, `PollComposeForm.tsx`, `SendMessageMenu.tsx`.
- Not opened: the whole `image-overlay/` folder (about 4.7k lines), `thread-embed/`,
  `naggFeedClient.ts`, `facadeFeedClient.ts`, the three facade adapters, `feedClient.ts` types,
  `feedParse.ts`, `feedRows.ts`, `notificationGroups.ts`, `useNotificationsPage.ts`,
  `useFeedContentState.ts`, `useAllSearchResults.ts`, `useOverlaidContactSearch.ts`,
  `sendMessageRecommendation.ts`, the demo components, `data/__scripts__/probeNagg.ts`.
- Test files were classified by their imports and `it(...)` titles; I did not read their bodies,
  so "PINNED" means a test imports the real module and its titles name the behaviour, not that I
  checked each assertion.
- Outside the area and not followed: `shared/lib/nostr/**` (publish seam, moderation sync),
  `wallet/react` payment machine, `pendingZapStore`, `profileStore` beyond its `partialize`,
  `accountRegistry`.
- No test was run and nothing was checked on a device.
