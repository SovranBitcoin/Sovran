# Pass 3 survey: stores and the persistence layer (deepening modules)

Area: every Zustand store under `app/shared/stores` (global, profile, runtime), the stores defined in `app/features`
and `app/shared/lib` (`bitchatDmMessages`, `composerStore`, `ignoreStore`, `notificationPolicyStore`, the three
`nip46*` stores, `themeDraft`, `relayListStore`, `mediaServerStore`, `wallpaperRenderState`), and
`app/shared/lib/persist`. Checkout `sovran-surgery`, branch `surgery/pass-3` (head `999c5583f`). Paths are relative
to `app/` unless they start with `wallet/`.

Method: every store action and state field was counted against its callers with a script (word match over `app`,
`wallet/src`, `nostr/src`, production files apart from tests), then each candidate was read end to end. `bun run knip`
is clean: store actions are object members, not exports, so knip cannot see a dead action. No test was run. Every
claim is **traced** (read) unless it says otherwise.

Rule kept throughout: nothing below changes a storage key, a version, a `partialize` output, a schema or a wire
format. Where a candidate would, it says so and stops.

## Ranking

| # | Candidate | Obligation removed | Lines (prod, rough) | Risk | Size | Mechanical |
| - | --- | --- | --- | --- | --- | --- |
| 1 | Store load: one hook and one wait owned by `persist/hydrationOutcome.ts` | 18 hand-rolled "wait until loaded" copies, 3 parallel flags | −130 / +40 | startup gates | M | yes, with the latch kept |
| 2 | Dead store surface: actions and runtime state nobody uses | 24 members with no production caller | −170 | none (2 owner questions) | S each | yes |
| 3 | Active account key: one selector and one owner capture in `profileStore` | 15 inline `profiles.find(...)` copies, 4 owner checks | −45 / +15 | account isolation | M | yes |
| 4 | Profile list saved now: one writer for the `profile-store` blob | 4 hand-built envelopes, 2 storage-muting dances | −45 / +20 | saved data (shape unchanged) | S | yes, pinned |
| 5 | Transaction source: one reader (annotations), one paired writer | 3 dual writes, first-write-wins rule in 2 places, a reader on the wrong source | −35 / +10 | display only; fixes DF1 | S | no (fixes DF1) |
| 6 | Settings flags: one typed setter | 22 one-line setters, 2 selector lines per toggle | −110 / +20 | log names (one e2e story) | S | yes |
| 7 | Routstr credential retirement in one action | caller reads 3 store fields to hand back, 3 separate writes | −35 / +12 | prepaid AI balance keys | S | yes |
| 8 | Standing quote identity adapter owned beside `mintStore` | adapter written 3 times, "is this the standing quote" 3 times | −15 | receive QR identity | S | yes |
| 9 | Send reachability probe owned by the store | screen runs the 4-state probe through 4 raw setters | −30 / +15 | display only | S | yes |
| 10 | Root-entry reset with one owner (machine `onReset`) | "call `clearPaymentContext` before `machine.x({reset})`" at 8 sites | −10 / +8 | payment routing | M | yes, pin first |
| 11 | Captured-owner store teardown owned by `defineStore` | registry removal hand-written in `vertexBudgetStore` | −12 / +8 | none | S | yes |
| 12 | Like and repost overlays keyed by kind | `toggleSlice` adapter rebuilding a per-kind interface | −25 / +5 | display only | S | yes |
| 13 | Persisted store definition: name and storage worked out from the declaration | name written twice, storage chosen by hand in 41 stores | −120 / +30 | saved data keys (checked by tests) | L | yes, generated manifest |

Ranked by obligations removed and lines deleted over risk. 1 to 4 are the ones that matter most; 5 also fixes a
defect.

---

## 1. Store load: one hook and one wait owned by `persist/hydrationOutcome.ts`

1. **Module and callers.** `shared/lib/persist/hydrationOutcome.ts:8-68` already owns "did this store load"
   (`hydrationSettled`, the `failed` set) but only `migrateThenLoad` and the Routstr first-launch path use it.
   Eighteen other places read zustand's `persist.hasHydrated()`/`onFinishHydration` by hand, in five shapes:
   - React latch (`useState` + effect + re-check): `shared/blocks/AppGate.tsx:42-52` (settings),
     `shared/stores/global/walletLifecycleStore.ts:105-117` (`useWalletLifecycleHydrated`),
     `shared/blocks/CtaHost.tsx:35,40-42`, `features/nostrSigner/hooks/useNostrSignerService.ts:47-56`
     (`useNip46ConnectionsHydrated`, whose doc says "same pattern as `useWalletLifecycleHydrated`").
   - External store: `features/ai/screens/ProviderListScreen.tsx:83-85`,
     `features/payments/hooks/useDmEcashAutoRedeem.ts:95-109` (the only one that also listens to `onHydrate`, so it
     goes back to false during a re-read).
   - Promise "when loaded": `shared/lib/migrations/dataMigrations.ts:81-91` (`whenHydrated`),
     `shared/lib/cashu/profileScopedStorage.ts:60-68` (`ensureProfileStoreHydrated`),
     `shared/lib/cashu/walletDatabaseRecord.ts:49-59`, `shared/lib/nostr/vertex/refreshVertex.ts:52-64` (with a 2 s
     bound), `shared/stores/runtime/mockDataStore.ts:453-464` (`afterHydrationOnce`),
     `features/payments/hooks/useDmConversations.ts:141-143` and `useDmThread.ts:123-125` (`if (!hasHydrated())
     await rehydrate()`).
   - Run-on-load subscriptions: `features/nostrSigner/hooks/useSignerApprovalController.ts:152-153`,
     `shared/lib/nostr/ownsync/useMuteListSync.ts:25,34`, `shared/lib/nostr/ownsync/useFollowSync.ts:28-32`.
   - Parallel flags for the same fact: `useSettingsHydration` (`shared/stores/global/settingsStore.ts:12-17`, set in
     `afterHydrate` `:558`) is a second record of what `hydrationOutcome`'s `failed` set already records; AppGate reads
     both for the same store (`AppGate.tsx:42-52` and `:141,152`). `themeStore._hasHydrated` (`themeStore.ts:70,86,
     108-114`) has **no reader** (`ThemeProvider.tsx:45-50` explains it must not gate on it).
2. **Obligation today.** Each caller must remember the render-to-effect race ("Fallback: hasHydrated may have flipped
   between initial render and effect run", `walletLifecycleStore.ts:112`), unsubscribe after the first call
   (`dataMigrations.ts:86-89`, `profileScopedStorage.ts:63-66`, `mockDataStore.ts:461-463`), and decide what a load
   that fails means: the latches and promise waits never settle on a failed read (zustand does not call
   `onFinishHydration` on an error, which is why `hydrationOutcome` exists), `refreshVertex` bounds its own wait, and
   AppGate keeps a separate status store to see the failure.
3. **Proposed shape.** `hydrationOutcome.ts` exports `useStoreLoad(store): 'loading' | 'loaded' | 'failed'` (an
   external store over `onHydrate`, `onFinishHydration` and its own `failed` listeners) and
   `whenLoaded(store, { timeoutMs? }): Promise<boolean>` (`hydrationSettled` with an optional bound). The latches
   become `useStoreLoad(x) === 'loaded'`; `useSettingsHydration` and its `setState` calls go (AppGate's retry keeps
   calling `persist.rehydrate()`, which `markHydrationStarted` already resets); `whenHydrated`,
   `ensureProfileStoreHydrated`, `afterHydrationOnce`, the vertex wait and the two DM checks become `whenLoaded`.
   `themeStore._hasHydrated` and its `afterHydrate` (the write-skip dance included) are deleted. `wallpaperStore.
   _hasHydrated` stays: it means "loaded **and** files verified" (`wallpaperStore.ts:323-342`).
4. **Deletion test.** Deleting the eighteen copies loses nothing a caller needs: each is the same three facts
   (loaded now, became loaded, failed), and the one owner already holds the third.
5. **Lines.** About −130 production lines (the two exported hooks alone are 35), +40. Net down. `useSettingsHydration`
   also leaves `storeRegistryManifest.ts` (regenerate it).
6. **Risk.** Startup gates (terms, restore, CTA, signer). Two semantic choices must be made explicit, not changed by
   accident: (a) the latches stay `true` across a later `rehydrate()`; `useDmEcashAutoRedeem` deliberately goes back
   to `false`. Give `useStoreLoad` the non-latched behaviour and keep the latch at the four latch callers
   (`useLatched(useStoreLoad(x) === 'loaded')`) unless the owner rules otherwise. (b) Promise waits that wait for ever
   on a failed read would now resolve `false`; each caller must keep doing nothing on `false` (they do today by
   never resuming). Nothing stored changes. Not money.
7. **Pins.** `hydrationOutcome`, `appGateOrder`, `appGateReinstallDetection` (uses `useWalletLifecycleHydrated`),
   `restoreGateDecision`, `ctaHost`, `ctaLatestVersionFetch`, `settingsStorePersistResilience`
   (`useSettingsHydration`), `useDmEcashAutoRedeem`, `dataMigrations`, `profileScopedStorage`, `walletDatabaseRecord`.
   Pin first: the settings retry screen (a failed settings read shows the terms screen with Retry, Retry reloads), and
   `useNip46ConnectionsHydrated` (no test names it).
8. **Size.** M (about 16 files). Mechanical once (a) is settled.

## 2. Dead store surface: actions and runtime state nobody uses

1. **Module and callers.** Members with no production caller (word search over `app`, `wallet/src`, `nostr/src`,
   `app/e2e`; "test" means only a test calls it):

   | Store | Member | Callers |
   | --- | --- | --- |
   | `shared/stores/profile/routstrStore.ts:582,1280-1288` | `updateMessage` | none |
   | `routstrStore.ts:564,1209-1212` | `setApiKey` | test (`routstrChangeHeader`, `routstr402BalanceSync`) |
   | `routstrStore.ts:637,1499-1501` | `beginPayment` | test (`routstrStorePersistResilience`). Its last caller went in `e8b1323fe` when the Routstr SDK took over recording the token; `pendingPayments` is now read only for rows older releases wrote (`shared/lib/routstr/reclaim.ts:122`), so `settlePayment` and the field stay |
   | `shared/stores/global/settingsStore.ts:273,348` | `getDisplayCurrency` | none |
   | `settingsStore.ts:292,410` | `isTermsAccepted` | test only; the gate uses `hasCurrentLegalAcceptance` (`AppGate.tsx:134`) |
   | `settingsStore.ts:271,343` | `getDisplayBtc` | 5, all as `s => s.getDisplayBtc()` (`MonthlyChart.tsx:245`, `PrimaryBalance.tsx:221`, `AmountFormatter.tsx:108`, `PaymentStatusToast.tsx:36`, `lib/currency.ts:88`): a getter for a field the selector can read |
   | `features/bitchat/stores/bitchatDmMessages.ts:157-159,363-372` | `getForPeer`, `clearForPeer` | test only |
   | `features/composer/state/composerStore.ts:48-51,102-112` | `moveBlock`, `setContentWarning`, `addMention` | test only. `contentWarning` and `mentionPubkeys` are therefore always `undefined`/`[]` when `useComposerActions.ts:112-113,212-213` publishes |
   | `features/feed/stores/ignoreStore.ts:35-36,181-190` | `unignoreEvent`, `clearIgnoredFeedItems` | none |
   | `features/feed/stores/notificationPolicyStore.ts:24,63-67` | `resetNotificationPolicy` | test only |
   | `features/nostrSigner/data/nip46ConnectionsStore.ts:299,306,638-641,669-678` | `unblockApp`, `updateMetadataAfterApproval` (and `UpdateMetadataInput`, `:228`) | test only |
   | `features/theme/lib/themeDraft.ts:48,175-182` | `resetDraft` | test only |
   | `shared/stores/global/walletLifecycleStore.ts:28,72-76` | `setRestoreStatus`'s `error` parameter | no caller passes it (`AppGate.tsx:243,246`, `walletDatabaseRecord.ts:47`) |
   | `shared/stores/runtime/nfcTapStore.ts:3-5,20-35` | `armed` and `setArmed` | written at `features/wallet/hooks/useAmbientNfcArm.ts:88-141,122,157`, read by nothing; the "pulse indicator" the comment names does not exist |
   | `shared/stores/profile/themeStore.ts:70,86,108-114` | `_hasHydrated` | no reader (with candidate 1) |
   | `shared/stores/profile/scanHistoryStore.ts:62-82,163-207,224-228` | `entriesByTransactionId` index and `buildEntriesByTransactionId` | maintained by `addScan`, `linkTransaction`, `afterHydrate` (by mutating the state object) and rebuilt by hand in `mockDataStore.ts:483-497`; read only by tests. The one production reader of scans by transaction scans `entries` instead (`createSovranScreenActionsBridge.ts:282-284`) |

2. **Obligation today.** Readers of each interface learn members that do nothing for them; two of them mislead:
   `scanHistoryStore`'s doc says row selectors use the index (none do), and the mock purge has to keep an unused index
   in step. `getDisplayBtc` makes every selector call a method to read a field.
3. **Proposed shape.** Delete each member, its interface line and its test. Tests that used a deleted setter to seed
   state (`setApiKey`, `beginPayment`) seed with `setState`. `s.getDisplayBtc()` becomes `s.displayBtc`.
   `setRestoreStatus(status)` drops the parameter and writes `lastRestoreError: null` as today. Saved fields stay in
   every `partialize` (`apiKey`, `pendingPayments`, `ignoredEventIds`, `contentWarning` is not saved).
4. **Deletion test.** Nothing reappears at any caller: there are none.
5. **Lines.** About −170 production lines, −150 test lines. Net down.
6. **Risk.** None to stored data or wire formats. Two are owner questions before deleting rather than dead code
   (listed under "Owner questions" below): there is no way in the app to show a hidden post again, and no way to
   unblock a blocked signer app except, perhaps, reconnecting (not traced).
7. **Pins.** The tests named in the table are the only pins and go with their members: `bitchatDmMessages.test.ts:74,
   147`, `composerStore.test.ts:35-36,109-133`, `feedPreferenceStores.test.ts:52`, `nip46ConnectionsStore.test.ts:316,
   350-380`, `themeDraftCommit.test.ts:241`, `scanHistoryStoreNormalise.test.ts:99-128`, `scanHistoryUpgrade.test.ts:
   70-137` (its index assertions only; its upgrade assertions stay), `settingsStorePersistResilience.test.ts:85-186`
   (`isTermsAccepted()` there becomes a read of `termsAccepted`).
8. **Size.** S per store, about 12 stores. Mechanical.

## 3. Active account key: one selector and one owner capture in `profileStore`

1. **Module and callers.** `profileStore.ts:203-212,356` exports `selectActiveProfile` and `getActiveProfile()`;
   `shared/lib/cashu/profileScopedStorage.ts:71-74` exports `getActiveProfilePubkey()` (6 production importers). Beside
   them, 15 inline copies of `profiles.find((p) => p.accountIndex === activeAccountIndex)?.pubkey`:
   `app/(settings-flow)/moderation.tsx:6`, `features/settings/screens/SettingsMediaScreen.tsx:201`,
   `features/bitchat/lib/profileScope.ts:11,19` (a whole 22-line module of two copies),
   `features/nostrSigner/components/SignerConnectSheetContent.tsx:540`, `shared/blocks/KeyRecoveryScreen.tsx:62`,
   `shared/hooks/useProfileDisplay.ts:27`, `shared/hooks/useNostrProfileMetadata.ts:107`,
   `shared/lib/routstr/sdk/client.ts:131,535`, `shared/lib/nostr/vertex/refreshVertex.ts:23-25` (its own
   `activePubkey`), `shared/lib/nostr/ownReplaceableEvent.ts:17,21`, `shared/lib/nostr/ownsync/useOwnEventsSync.ts:125`.
2. **Obligation today.** Every caller re-derives the key and the "is this still the account that started" check:
   `client.ts:129-136` (`assertOwner`), `refreshVertex.ts:66-70`, `useDmEcashAutoRedeem.ts:149`,
   `dataMigrations.ts:56`, `publishOwnProfileMetadata.ts:151,190`, `SettingsEditProfileScreen.tsx:208`,
   `rebalanceStepSink.ts:38`. They differ: `ownReplaceableEvent.captureProfile` (`:14-27`) notices switching away and
   back (it latches false on any index change); the plain `=== pubkey` checks do not. Which one a caller needs is
   decided at each caller, unstated.
3. **Proposed shape.** `profileStore` owns `selectActivePubkey(state)`, `activePubkey()` and `useActivePubkey()`, and
   `captureActiveProfile(pubkey)` (moved from `ownReplaceableEvent.ts`, which keeps its re-export or its callers
   move). `getActiveProfilePubkey` becomes the store's `activePubkey` (profileScopedStorage imports it). The inline
   finds go; `bitchat/lib/profileScope.ts` becomes `useActivePubkey() ?? ''`. The owner checks stay as they are
   (each picks `activePubkey() === owner` or `captureActiveProfile`); only the derivation moves.
4. **Deletion test.** Deleting the inline copies loses nothing: each is the same two-field lookup.
5. **Lines.** About −45, +15.
6. **Risk.** Account isolation reads these. The lookup is identical, so behaviour is unchanged; converting a plain
   check into `captureActiveProfile` (or back) would change behaviour and is out of this step.
7. **Pins.** `profileStoreActiveSelector`, `profileStoreCapacity`, `profileScopedStorage`, `inProcessProfileSwitch`,
   the `mintRebalance*` and `nutDropRedeemQueue*` suites (they mock `getActiveProfilePubkey`, so a moved import must
   keep the mocked path or the mocks move with it), `routstrPaymentOwnership`.
8. **Size.** M (about 17 files). Mechanical.

## 4. Profile list saved now: one writer for the `profile-store` blob

1. **Module and callers.** The store saves through persist, which gives no completion. Four places therefore build
   the saved envelope by hand: `shared/lib/profile/profileTransition.ts:121-129` (`persistSwitchTargetToDisk`),
   `shared/lib/cashu/walletDatabaseRecord.ts:103-109` (`forgetWalletDatabases`),
   `shared/lib/profile/profileRemovalStorage.ts:353-359`, and `shared/lib/profile/profileSessionOrchestrator.ts:545-550`
   (through `persist.getOptions().storage`). Two of them also mute the store's own saves by swapping its storage
   for a no-op and back: `profileTransition.ts:142-154` (`activateProfileInMemory`) and
   `profileRemovalStorage.ts:347-366`. `profileSessionOrchestrator.ts:533-543` hand-writes the `wallet-lifecycle` blob
   the same way. `PROFILE_STORE_PERSIST_VERSION` is exported only so these writers stamp the right version
   (`profileStore.ts:161-167`).
2. **Obligation today.** Each writer must repeat `{ state: { activeAccountIndex, profiles }, version }` (the store's
   `partialize` and `version`, `profileStore.ts:362-367`) and, to mute, remember to restore the storage in `finally`.
   `withSkippedPersistWrites` exists for the same purpose but only works for profile-scoped stores
   (`persistConfig.ts:305-311`), which is why the global profile store needs the swap.
3. **Proposed shape.** `persistConfig` returns, beside the options, `saveNow(state): Promise<void>` (writes
   `{ state: partialize(state), version }` through the store's own JSON storage, so failed-save logging applies) and
   `withoutSaving(fn)` (the swap, once). `profileStore` exports `saveProfileListNow(next)` and
   `setProfilesWithoutSaving(fn)` built on them. The four envelopes and two swaps go. The orchestrator's lifecycle
   blob uses the lifecycle store's `saveNow`. `PROFILE_STORE_PERSIST_VERSION` stops being exported.
4. **Deletion test.** Removing the hand writers moves their one rule (shape and version of the blob) back to the one
   module that owns it.
5. **Lines.** About −45, +20.
6. **Risk.** Saved data: the bytes written must be the same. Through the store's JSON storage they also pass the
   unreadable-blob guard, which today they skip: if the profile list had been turned down at load, `saveNow` would set
   the unreadable blob aside before writing, where the hand writers overwrite it. That is safer but is a behaviour
   change on a damaged install; say so in the commit, or keep the raw `AsyncStorage` path for the first step. The
   read-back in `forgetWalletDatabases` (`:62-78`) stays its own.
7. **Pins.** `profileStoreSideWriters` (switch target, removal, onboarding recovery; it compares each blob with the
   store's own save), `walletDatabaseRecord`, `inProcessProfileSwitch`, `accountSwitchBoundary`. Pin first: the
   `forgetWalletDatabases` blob (the ledger notes it is exercised, not asserted) and `activateProfileInMemory` (no test
   names it).
8. **Size.** S (5 files). Mechanical with the raw path kept.

## 5. Transaction source: one reader (annotations), one paired writer

1. **Module and callers.** Where a transaction came from (scanned how, or shared how) is recorded twice: in the legacy
   stores (`scanHistoryStore`, `transactionDistributionStore`, `transactionLocationStore`) and in transaction
   annotations (`transactionAnnotationStore.ts`). Every writer writes both by hand:
   `features/send/lib/createSovranScreenActionsBridge.ts:381-382`, `features/send/lib/sovranPaymentConfig.ts:1723-1724`,
   `:1763-1764` (distribution), `sovranPaymentConfig.ts:518-535` and `:748-750` (scan), `shared/hooks/
   useTransactionLocation.ts:62-65` (location). The first-write-wins rule exists twice:
   `transactionDistributionStore.ts` `setDistribution` and `transactionAnnotationStore.ts:116-122`
   ("matches the legacy distribution store's guard"). Two readers, two sources: the transaction row reads annotations
   (`features/transactions/components/Transaction.tsx:88-93`), the transaction screen's source label reads the legacy
   stores (`createSovranScreenActionsBridge.ts:278-292`, re-published on changes to both stores at `:478-488`).
2. **Obligation today.** Remember to write both, in the same order, with the same key convention (`quoteId` in one,
   `quote:${quoteId}` in the other).
3. **Proposed shape.** `transactionAnnotationStore` owns `recordDistribution(quoteId, source)` (writes the legacy
   store and the annotation) and `recordLocation(id, coords)`; the three distribution pairs and the location pair
   become one call. `getSourceLabel` reads `scan?.method ?? distribution?.source` from annotations over
   `candidateKeys(entry)` (`wallet/src/annotations/key.ts:102`), the row's rule, and its two store subscriptions become
   one annotation subscription.
4. **Deletion test.** The second write cannot be deleted (below); the second reader can, and the label then agrees
   with the row.
5. **Lines.** About −35, +10.
6. **Risk.** The legacy stores must keep being written: a downgrade to 0.1.3 reads them (pass 2 notes the swap quote
   index for the same reason), so stopping those writes would change what is stored. Only the call shape changes.
   Moving the reader changes what the screen shows (DF1); display only.
7. **Pins.** `dataMigrations` (the import that makes the two sources agree for old data),
   `sovranPaymentConfig.profile`, `transactionDetailProbe`. Nothing pins `getSourceLabel`; pin first the label for a
   scanned receive, a copied and a shared mint quote, and DF1.
8. **Size.** S (4 files). Not purely mechanical: it fixes DF1.

## 6. Settings flags: one typed setter

1. **Module and callers.** `settingsStore.ts:267-318` declares 27 actions; 22 are `log + set({ field })`
   (`:339-462`). Each has exactly one caller, in four settings screens; the screens read each flag with two selectors,
   value and setter (`features/settings/screens/SettingsScreen.tsx:203-226`, 24 lines for 12 toggles;
   `SettingsNetworkScreen.tsx:87-97`; `SettingsStorageScreen`, `SettingsKeyringScreen`, `SettingsRoutingScreen`).
2. **Obligation today.** A new flag needs an interface line, an implementation with its own log name, and two
   selector lines at its screen. Two setters already skip the log (`setInProcessProfileSwitch :381`,
   `setVertexCreditsEnabled :437`).
3. **Proposed shape.** `setFlag<K extends SettingsFlag>(key: K, value: SettingsState[K])` with `SettingsFlag` the
   boolean keys plus `displayBtc`, `displayCurrency`, `minTransferThreshold`, logging
   `store.settings.set_<snake key>` so every event name stays as it is (`app/e2e/stories/library/
   the-app-says-when-it-is-offline.json:156` waits on `store.settings.set_mock_offline`). Rules stay as named actions:
   `setFileLoggingEnabled` (drives the logger), `setPrimalHostEnabled`, `setMiddlemanRouting` (partial merge),
   `setLastKnownAppVersion` (clips), `acceptLegalDocuments`, `completeOnboarding`. A screen row reads
   `useSettingsStore((s) => s.mockMode)` and calls `setFlag('mockMode', v)`.
4. **Deletion test.** The 22 setters hold no rule; deleting them loses nothing but their log names, which the one
   setter reproduces.
5. **Lines.** About −110 (store about −80, screens about −30), +20.
6. **Risk.** None to stored data: `partialize`, schema and `migrate` are untouched. Two log names change unless the
   two unlogged setters keep not logging (decide; adding a log is harmless).
7. **Pins.** `settingsStoreSetters`, `settingsStorePersistResilience`, the e2e story above. Most toggles have no test;
   none needs one beyond a table test of `setFlag` over every key.
8. **Size.** S (store plus 5 screens). Mechanical.

## 7. Routstr credential retirement in one action

1. **Module and callers.** `shared/lib/routstr/api.ts:712-720`: on a 401 that retires the key, the caller reads
   `nodeBaseUrl`, `apiKey` and `balance` from the store, then calls `archiveAccount(state.nodeBaseUrl, requestKey,
   state.balance)`, `clearApiKey()`, `clearBalance()`. These three actions (`routstrStore.ts:568,565,576`,
   `:1214-1224,1250-1263`) have that one production caller (plus `setBalance` at `api.ts:742`). The store already
   archives inside one `set` on its other two moves (`setServerLineup`, `setUserNode`).
2. **Obligation today.** The caller hands back three values the store owns, guards "is this still the key"
   (`api.ts:712`) and orders three writes, each a separate save of the secret vault.
3. **Proposed shape.** `retireApiKey(requestKey): boolean` in the store: if `apiKey === requestKey`, archive with the
   store's own `nodeBaseUrl` and `balance`, clear both, in one `set`. `clearApiKey`, `clearBalance` and
   `archiveAccount` leave the interface (with candidate 2's `setApiKey`, `updateMessage`, `beginPayment`).
4. **Deletion test.** The three setters exist only to let this caller do the move by hand.
5. **Lines.** About −35, +12.
6. **Risk.** Money: the key is the bearer instrument for a prepaid node balance (the comment at `api.ts:704-711`).
   One `set` keeps the order "archived before cleared" by construction, where today a throw between calls is the only
   gap. Saved shape unchanged.
7. **Pins.** `routstrAccountArchive`, `routstr402BalanceSync`, `routstrSecurePersistence`, `routstrChangeHeader`.
   Pin first: a 401 "spent" archives the key with the live balance and clears both; a 401 for a different key changes
   nothing.
8. **Size.** S (2 files). Mechanical.

## 8. Standing quote identity adapter owned beside `mintStore`

1. **Module and callers.** `features/receive/lib/standingQuoteIdentityStore.ts:15-22` is "the ONE persisted identity
   map" over `mintStore.standingQuotes`; `shared/hooks/usePaymentStatusListener.ts:352-355` and `:482-485` build the
   same `{ get, set }` adapter inline (shared cannot import the receive feature cleanly). "Is this the standing quote"
   is read three times: `usePaymentStatusListener.ts:474,576`, `features/receive/screens/ReceiveRailListScreen.tsx:
   104-110`. `usePaymentStatusListener.ts:351` writes `.slice(0, 5)` where the module exports `MAX_ADVERTISED_MINTS`.
2. **Obligation today.** Know the key shape and rebuild the adapter.
3. **Proposed shape.** Move the adapter and `isStandingQuote(key, id)` into `shared/stores/profile/mintStore.ts` (or a
   sibling); the receive feature and the listener import it.
4. **Deletion test.** The two inline adapters are copies.
5. **Lines.** About −15.
6. **Risk.** The receive QR's identity; the adapter is the same functions. Saved data unchanged.
7. **Pins.** `walletReusableMintQuoteHook`, `walletStandingPaymentRequestHook`, `paymentStatusListener`,
   `receiveScreenLayout`, `bip321RailSelection.integration`.
8. **Size.** S. Mechanical.

## 9. Send reachability probe owned by the store

1. **Module and callers.** `shared/stores/profile/sendReachabilityStore.ts:29-35,85-90` exposes `markChecking`,
   `markDeviceOffline`, `markMintReachable`, `markMintUnreachable` and `pruneOld` over one private `setStatus`.
   `features/send/screens/SendTokenScreen.tsx:97-141` runs the probe: read the current entry, mark checking, short-cut
   on offline or a settled verdict, fetch `/v1/info`, mark the verdict, guard cancellation.
   `sovranPaymentConfig.ts:1128-1129` seeds it with `markChecking` then `pruneOld`.
2. **Obligation today.** The screen owns the probe's rules through four raw setters; the seeding caller must
   remember to prune.
3. **Proposed shape.** The store (or a `useSendReachabilityProbe(transactionId, mintUrl, isOffline)` hook beside it)
   owns the probe; the store's interface becomes `track(transactionId, mintUrl)` (mark checking and prune) and the
   read hook. Network stays injected (`fetchMintInfo`).
4. **Deletion test.** The four setters encode no rule; the rule is in the screen.
5. **Lines.** About −30, +15.
6. **Risk.** Display only. Saved shape unchanged.
7. **Pins.** None of the probe. Pin first: offline, reachable, unreachable and "settled verdict not re-probed".
8. **Size.** S. Mechanical.

## 10. Root-entry reset with one owner (machine `onReset`)

1. **Module and callers.** `shared/stores/runtime/clearPaymentContext.ts:10-50` says it "MUST be called at the ROOT
   of every payment/scan entry point" and that Colada's own context is reset separately by `{ reset: true }`. 19 call
   sites; at 8 the clear is immediately followed by a machine call with `reset: true`:
   `features/wallet/screens/WalletScreen.tsx:98-99,119`, `features/user/screens/UserMessagesScreen.tsx:521-522`,
   `features/feed/components/nostr/NoteContent.tsx:286-287`, `features/ai/lib/navigateToAddFunds.ts:12-14`,
   `features/wallet/hooks/useWalletMintListRequest.ts:23-27`, `features/settings/screens/SettingsDesignSystemScreen.tsx:
   91-92,100-101`. The machine resets in one place (`wallet/src/machine/createMachine.ts:2429-2667`, `resetInternal`).
   The wallet already takes an app hook for the same purpose on scan (`deepLinks.onBeforeScan`,
   `wallet/src/react/ColadaProvider.tsx:92,834`; `features/send/providers/Colada.tsx:630`).
2. **Obligation today.** Every new root must remember both resets; the wallet's own receive hub
   (`wallet/src/screen-actions/defaultHandlers.ts:646-665`) resets the machine without the app's clear and is safe
   only because the hub is reached from a root that already cleared.
3. **Proposed shape.** `createColada({ onReset })`, called by `resetInternal`; the app passes
   `() => clearPaymentContext('machine.reset')`. The 8 paired sites drop their clear; roots that start no machine flow
   (camera, Nut Drop radar, NFC, zaps) keep theirs.
4. **Deletion test.** The paired clears duplicate a reset the machine already performs at the same moment.
5. **Lines.** About −10, +8. Small; the value is the rule moving to one place.
6. **Risk.** Payment routing: a missed clear routes a token to a stale contact (the file's own warning). Order matters
   at `useZap.ts:134-136` (clear before registering the zap), which keeps its explicit clear. Log `reason` values
   become one for the 8 sites.
7. **Pins.** `clearPaymentContext`, `paymentRootContext`, `paymentRouteReentry`, `sovranColadaProviderWiring`,
   `aiAddFunds`, `NoteContent`. Pin first: each of the 8 roots leaves no contact, nearby, lock or draft behind.
8. **Size.** M (crosses into `wallet/`). Mechanical after the pin.

## 11. Captured-owner store teardown owned by `defineStore`

1. **Module and callers.** `defineVanillaStore` (`shared/lib/persist/defineStore.ts:121-129`) has one caller,
   `shared/stores/profile/vertexBudgetStore.ts:26-100`, which on dispose flushes its writes, rehydrates to cancel,
   resets with saves skipped, detaches storage, then splices itself out of `liveStores` and `persistRegistry` by hand
   (`:88-96`). The registries are filled by `defineStore.record` (`:13-23`) and `persistConfig` (`:281-294`).
2. **Obligation today.** A captured-owner store must know both registries' internals to leave them.
3. **Proposed shape.** `defineVanillaStore` returns the store with `forget()` (removes it from both registries);
   `vertexBudgetStore` calls it.
4. **Deletion test.** The splice code is registry knowledge in the wrong module.
5. **Lines.** About −12, +8.
6. **Risk.** None to stored data.
7. **Pins.** `vertexBudgetStore`, `storeRegistry`, `accountSwitchBoundary`.
8. **Size.** S. Mechanical.

## 12. Like and repost overlays keyed by kind

1. **Module and callers.** `nostrSocialStore.ts:194-215,708-752`: `setLikeOptimistic`, `setRepostOptimistic`,
   `clearLikeOptimistic`, `clearRepostOptimistic`. Their one caller, `features/feed/hooks/useNostrEngagement.ts:40-56`,
   rebuilds a per-kind interface (`toggleSlice`) to undo the split, and `settleOverlays` (`:186-245`) repeats the
   like/repost branches.
2. **Obligation today.** The caller maps a kind onto two setter pairs and two maps.
3. **Proposed shape.** `setToggleOverlay(kind, eventId, params)`, `clearToggleOverlay(kind, eventId)` and
   `toggleOverlays(state, kind)`; `toggleSlice` goes. The two saved maps stay as they are.
4. **Deletion test.** `toggleSlice` exists only to recombine the store's split.
5. **Lines.** About −25, +5.
6. **Risk.** Display only. Saved shape unchanged.
7. **Pins.** `useNostrEngagement` suites (`postMenuActions`, `homeFeedLoad`), `nostrSocialStoreOwnSync`.
8. **Size.** S. Mechanical.

## 13. Persisted store definition: name and storage worked out from the declaration

1. **Module and callers.** 41 `persistConfig({ name, storage, ... })` calls. In every one the `name` repeats the
   `defineStore({ name, scope })` above it, and in 37 the storage follows from the scope (22 `createProfileScopedStorage()`
   and 5 module-level `profileStorage` for `profile`, 10 `AsyncStorage` for `global`; the four others are Routstr's
   secure adapter, the vertex captured owner, the BTC Map file cache and `legacyEcashStore`). `persistConfig`
   already looks the scope up again (`persistConfig.ts:296-311`).
2. **Obligation today.** Write the key twice and pick the adapter that the scope implies; a mismatch would save a
   profile store under a bare key.
3. **Proposed shape.** `definePersistedStore<T>({ name, scope, schema, partialize, version?, migrate?, storage?, ... })
   (initializer)`, wrapping `persist` and `persistConfig`, with `storage` defaulting from `scope`. The four exceptions
   pass `storage`.
4. **Deletion test.** The repeated name and the scope-implied storage are derivable.
5. **Lines.** About −120 (three lines and an import per store), +30.
6. **Risk.** Saved data keys: each store must keep its key, scope and adapter exactly. `persistSchemaDrift`,
   `storeRegistry`, `e2eStoreManifest` and `releasedPersistedSurface` check names and versions; `storeRegistryManifest.ts`
   is generated and must be regenerated. Also: `shared/stores/global/nostrMetadataCache.ts:116-130` is declared
   `profile` and uses profile storage but sits in the `global` folder; move it in the same step.
7. **Pins.** The four suites above and every `*PersistResilience` suite.
8. **Size.** L (41 files). Mechanical, but lowest value per line of risk; last.

---

## Defects

### DF1. The transaction screen's source label disappears where the row still shows it

- **Where.** `features/send/lib/createSovranScreenActionsBridge.ts:278-292` reads the scan from
  `useScanHistoryStore.entries` and the distribution from `useTransactionDistributionStore`; the row reads annotations
  (`features/transactions/components/Transaction.tsx:88-93`). Scan history keeps the newest 500 scans
  (`shared/stores/profile/scanHistoryStore.ts:23,28-33`) and does not record a scan over 16,384 characters (`:26,161`);
  the scan annotation is written regardless (`features/send/lib/sovranPaymentConfig.ts:527-535`).
- **Path.** Receive a token by pasting or scanning it, then make 500 more scans (or paste a token over 16 KB, such as a
  token with many proofs). The transaction row still shows "Clipboard"/"QR Code"; its transaction screen shows no
  source.
- **Test idea.** Annotate `id:tx` with `scan.method = 'paste'`, leave scan history empty, call `getSourceLabel({ id:
  'tx' })`: expect "Clipboard" (fails today: null).
- **Touches stored data.** No (reader only; candidate 5). Not in `docs/follow-ups`.

Nothing else found that a maintainer would call a bug without asking. Checked and not defects:

- `themeStore.afterHydrate` (`:111-114`) saves the store again after every successful load (a `setState` inside
  persist always saves). Same bytes; a wasted write per load. Goes with candidate 1.
- `scanHistoryStore.afterHydrate` mutates the state object instead of calling `set`; subscribers are not told, but
  nothing reads the index (candidate 2).
- The latched hydration hooks stay `true` across an in-process re-read, but the account switch unmounts and remounts
  the providers after the re-read (`shared/lib/profile/inProcessProfileSwitch.ts`), so they re-read `hasHydrated()`
  then. Not reachable as a stale gate.
- `persistSwitchTargetToDisk` skips the unreadable-blob guard; a switch is not reachable with a turned-down profile
  list (the store's own first save sets the blob aside first). Noted under candidate 4.

### Owner questions (found while counting, not defects)

- `ignoreStore.unignoreEvent` and `clearIgnoredFeedItems` have no caller: a hidden post cannot be shown again from the
  app. Delete (candidate 2) or wire an undo?
- `nip46ConnectionsStore.unblockApp` has no caller: is a blocked signer app meant to be unblockable? (Whether
  reconnecting over a blocked record lifts the block was not traced: `SignerConnectSheetContent.tsx:547-552,797`.)
- `nfcTapStore.armed` promises a pulse indicator on the wallet NFC button that nothing draws.
- The composer has no way to set a content warning or record a mention, though publishing sends both.

---

## Not read

- `routstrStore.ts` lines 700-1190 and 1300-1650 beyond the actions named above; the conversation mirror
  (`conversationHistory`/`activeChildren` beside `sessions[current]`, pass 2 #10) was not re-surveyed: it is the next
  Routstr deepening after candidate 7, size L.
- `shared/lib/routstr/securePersistence.ts` with `createProfileScopedStorage(owner, true)`: whether its admitted
  writes also pass `persistConfig`'s profile write barrier (`persistConfig.ts:305-311`), which would defeat the
  admission, was not traced.
- `mintMetadataStore.ts` beyond its action list: the "liveness and `livenessAt` within my TTL" check is written twice
  with different TTLs (`shared/lib/cashu/mintHealth.ts:55-56`, `features/mint/lib/mintLiveness.ts:23-28`), a small
  helper candidate not ranked.
- `mintDistributionStore.ts` math, `relayListStore.ts`, `mediaServerStore.ts`, `ownContentStore.ts`,
  `ownedMediaStore.ts`, `ownProfileMetadataStore.ts`, `recentPeopleStore.ts`, `searchHistoryStore.ts`,
  `aiProviderDirectoryStore.ts`, `npcMintStore.ts` (D4 from pass 2 still stands), `wallpaperStore.ts` beyond
  `verifyIntegrity`, `btcMapStore.ts`, `pricelistStore.ts`, `mempoolAddressCache.ts`, `legacyEcashStore.ts`: action
  counts only.
- Runtime `popupStore`, `paymentStatusStore` (converted in pass 2; its interface was counted, not read), `legProgress`,
  `rollbackStore`, `amountDraftStore`, `sendLockStore`, `contactSendStore`, `nearPayStore`, `pendingZapStore`,
  `detailsSheetStore`, `pickerSheetStore`, `notePickerStore`, `dmEchoStore`, `deleteStatusStore`, `debugTierStore`.
- `persist/createMergeWithSchema.ts`, `preserveUnreadable.ts`, `tolerant.ts`, `fileCacheStorage.ts`, `storageUsage.ts`,
  `secureVault.ts` bodies (interfaces and callers only).
- `shared/lib/migrations/globalMigrations.ts` reads of `profile-store` (`:234,318,401`) and
  `shared/lib/nostr/secureStorage.ts:452`: read-only raw reads, left out of candidate 4.
- Caller counts are word matches; a common name (`clear`, `set`, `start`) was not counted and those actions were not
  judged. No test was run; nothing on a device.
