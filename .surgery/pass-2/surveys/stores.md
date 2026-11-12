# Pass 2 survey: stores (implicit state machines)

Area: every Zustand store under `app/shared/stores` (global, profile, runtime), the stores defined in `app/features`
and `app/shared/lib` that the manifest lists, and `app/shared/lib/persist`. Checkout `sovran-surgery`, branch
`surgery/pass-2` (pass 1 cuts and the redeem-queue repair are on it). Paths are relative to `app/` unless they start
with `wallet/`. No test was run; every claim is **traced** (read end to end) unless it says otherwise.

Persisted keys: a global store saves at its name, a profile store at `<name>:profile:<pubkey>`
(`shared/lib/cashu/profileScopedStorage.ts`). Versions come from the pass 1 inventory
(`.surgery/pass-1/surveys/stores.md`). "Decode at the read boundary" means: keep `partialize` writing exactly the
fields it writes today, and turn the parsed blob into a union in a selector or in `merge`, so no saved field is
renamed, removed or tightened.

## Ranking

| # | Candidate | Reachable illegal state today | Risk | Persisted | Cost | Call |
| - | --- | --- | --- | --- | --- | --- |
| 1 | Contacts document vs follow set (`nostr-social-store`) | yes: publishes a wrong kind-3 (D1), locks a follow button for good (D3) | public social data, wire | yes | M | convert |
| 2 | Swap group and leg lifecycle (`swap-transactions-store`) | yes: group `running` for ever (D2) | history of money moves | yes | M | convert |
| 3 | Wallet restore phase (`wallet-lifecycle`) | dead values, readers disagree on "settled" | gates minting | yes | M | convert (decode) |
| 4 | Payment routing context (runtime stores) | top-up branch unreachable; precedence implicit | where a token goes | no | S | convert + delete |
| 5 | Redeem queue entry (`nut-drop-redeem-queue`) | leftover `lastError`; `failed` means two things | bearer ecash | yes | M | convert (decode), after 1-3 |
| 6 | Store load verdict (`persist/*`, 21 hydration waits) | parallel flags kept in step by hand | every saved store | no | M | convert |
| 7 | Consent and onboarding (`settings-store`) | `termsAccepted:false` with a date; dead `isTermsAccepted` | legal gate | yes | S | convert (decode) |
| 8 | Relay list provenance (`nostr-relay-list-store`) | older relay list replaces unpublished edits (F203) | own relays | yes | S | convert (decode) |
| 9 | Payment status toast (`usePaymentStatusStore`) | `failed` with no message via `setActive`; replace of a live toast | display only | no | S | convert (table) |
| 10 | Routstr credential and session mirror (`routstr-store`) | `authMode` write-only; working copy mirror | prepaid sats | yes | L | defer to pass 3 |
| 11 | Mint liveness triple (`mint-metadata-store`) | `liveness` without `livenessAt` decodes as unknown | mint choice hint | yes | S | convert (decode) |
| 12 | Vertex budget sentinels (`vertex-budget-store`) | `9999-12-31` has no way out (D5) | paid lookups off | yes | S | leave, fix D5 |
| 13 | CTA presentation (`cta-store` runtime part) | `activeId`+`closingId`+`previewOverride` overlap | prompts | runtime part no | S | defer |
| 14 | Account kind (`profile-store` `source`/`externalChain`) | none found | keys | yes | S | leave |
| 15 | Small runtime pairs (`legProgress`, `rollbackStore`, `nfcTapStore`, `nearPayStore`, `npcMintStore`) | minor | low | no | S | leave, note D4/D6 |

---

## 1. Contacts document vs follow set (`nostr-social-store`)

1. **Files.** `shared/stores/profile/nostrSocialStore.ts:86-112` (state), `:385-411` (schema), `:425-447`
   (`setContactsFromRelay`), `:449-470` (`seedFollowsFromFacade`), `:474-508` (follow optimistic), `:717-730`
   (partialize). Writers: `shared/lib/nostr/ownsync/useOwnSocialGraphSeed.ts:40-60`,
   `shared/lib/nostr/ownsync/useOwnEventsSync.ts:46-47,86-91,127-133`. Publisher:
   `features/user/screens/UserProfileScreen.tsx:176-200` (`buildUpdatedContactTags`), `:1042-1110`
   (`toggleFollowContacts`), `:1288-1289`. Readers of the follow set: `features/feed/components/HomeFeed.tsx`,
   `features/feed/lib/feedEmptyStates.ts`, `features/nostrSigner/components/SignerApprovalSheetContent.tsx:141-152`,
   `shared/blocks/DrawerProfileChrome.tsx:211`, `shared/ui/composed/FollowBadge.tsx`, UserProfileScreen.
2. **Variables.** `contactsTags`, `contactsContent` (the signed kind-3 document), `contactsUpdatedAt` (one stamp
   for two things), `followingPubkeys` (a derived read set), `optimisticFollowsByPubkey[pk].{value,pending}`.
3. **States.** `Unknown` (stamp 0, nothing loaded), `SeededOnly(at)` (follow set from nagg/Primal, no document),
   `Document(at)` (tags and set agree), `DocumentBehind(docAt < seedAt)` (old document under a newer seed), and per
   person `FollowPending(value)`. Events: relay kind-3 (`setContactsFromRelay`, accepts `>=`), facade seed
   (accepts `>`, writes the set and the stamp only), local follow publish (builds from `contactsTags`), app kill.
4. **Meaningless combinations.** Stamp > 0 with `contactsTags` that do not contain the follow set; stamp 0 with a
   non-empty follow set; `pending: true` after a restart (nothing is in flight).
5. **Reachable today (traced).**
   - `SeededOnly`: a fresh install or new device mounts `useOwnSocialGraphSeed` →
     `seedFollowsFromFacade({follows, createdAtSec: T})` sets `followingPubkeys` and `contactsUpdatedAt = T`, leaves
     `contactsTags = []`. The relay subscription asks with `since = now - 1 year` for every kind
     (`useOwnEventsSync.ts:89-90`; the comment at `:46` says replaceable kinds ignore it, but NIP-01 `since` applies
     to every kind), so a kind-3 last changed more than a year ago never arrives, and one older than nagg's copy is
     refused by the `<` guard. The state then persists.
   - `DocumentBehind`: relay delivered T0, nagg later seeds T1 > T0; tags stay at T0.
   - `Unknown` + follow: stamp 0, tags `[]`, user taps Follow before any kind-3 arrived.
   - Pending after restart: see D3.
6. **Persisted.** `nostr-social-store` v2, profile scope: `contactsTags`, `contactsContent`, `contactsUpdatedAt`,
   `followingPubkeys`, `optimisticFollowsByPubkey` (plus engagement maps). The states decode from the saved shape
   without changing it: `Document` when the p-tags of `contactsTags` equal the keys of `followingPubkeys`,
   `SeededOnly`/`DocumentBehind` when they differ and stamp > 0, `Unknown` when stamp is 0. A document's own stamp
   is not stored; telling `DocumentBehind` from `SeededOnly` exactly needs an additive optional field
   (`documentUpdatedAt`, `.optional().catch(undefined)`), not required for the guard. `tolerantRecord` on
   `followingPubkeys` can drop an entry, so the decode must treat "set is a subset of the tags" as `Document`.
7. **Consumers.** Follow set: 7 files above. Document: 1 (UserProfileScreen). Stamp: 2 (store, signer sheet).
8. **Pins.** `nostrSocialStoreOwnSync.test.ts`, `nostrSocialStoreMigrate.test.ts`, `ownSyncLifecycle.test.tsx`
   (F203 item 3 is about the seed). **Nothing pins `seedFollowsFromFacade` or `toggleFollowContacts`** (grep finds
   no test that names either). Pin first: seed then follow publishes what; follow with stamp 0; a persisted
   `pending: true` after rehydrate.
9. **Recommendation: convert.** A `contactsState(state)` selector returning the union above, decoded from the saved
   fields; `toggleFollowContacts` accepts only `Document` (otherwise fetch the kind-3 first or refuse with a
   message). Optimistic follow as `{ kind: 'pending', value, since } | { kind: 'settled', value }`, decoded so that a
   loaded `pending` reads as `settled` (as `routstrStore.afterHydrate` already does for message `pending`).
10. **Deletes.** The implicit "tags are current" assumption in the publisher, the `followInFlight` guard's
    persisted half. Size M (store, seed hook, profile screen, signer sheet).

## 2. Swap group and leg lifecycle (`swap-transactions-store`)

1. **Files.** `shared/stores/profile/swapTransactionsStore.ts:23-79,141-208,238-344`;
   `features/mint/hooks/useMintRebalanceOrchestrator.ts:115-119,205-258,280-288,413-427`;
   `features/mint/lib/rebalanceStepSink.ts:114-160`; `shared/lib/cashu/reconcileSwapLegs.ts:24-87`;
   `features/transactions/components/SwapTransactionRow.tsx:23-33`;
   `features/transactions/screens/SwapTransactionScreen.tsx:218,328,467-480`;
   `features/transactions/components/MonthlyChart.tsx:126-162,246`; `features/mint/components/rebalance/routing.ts:314-354`;
   `features/mint/lib/rebalanceRouteCandidates.ts:50`; `shared/lib/migrations/dataMigrations.ts:149-156`.
2. **Variables.** Group `state` (`running|finished|cancelled`); per leg `localStatus` (nine values, optional),
   `errorMessage`, `mintQuoteId`/`mintOperationId`/`meltQuoteId`/`meltOperationId`; `quoteIdToGroup` (an index
   derived from the legs' quote ids); a third copy as transaction annotations `quote:<id>` → `swap.{groupId,role}`
   written beside every `tagMintQuote`/`tagMelt` (`rebalanceStepSink.ts:148-159`).
3. **States.** Group: `Running` → `Finished` | `Cancelled`. Leg: `pending → creatingInvoice → invoiceReady → melting →
   verifying → paymentPending | settling → done | failed`. The row derives `Failed | Pending | Completed` from both
   (`SwapTransactionRow.tsx:23-33`).
4. **Meaningless.** `Finished` group with a leg at `pending`/`creatingInvoice`; `Running` group that no run owns;
   a leg with `meltQuoteId` but no index entry (the index is `tolerantRecord`, a leg's ids are not); a leg with
   `localStatus` undefined (between `addLeg` and the `setLegStatus('pending')` that follows it,
   `rebalanceStepSink.ts:130-132`, synchronous, not persisted between).
5. **Reachable (traced).** `Running` with no owner — see D2: a thrown run, an aborted run (manager change) and an app
   kill all leave the saved group at `running`. Index without leg cannot happen through writers (both set in one
   `set`); leg without index happens after a load drops an index entry with an unknown `kind`.
6. **Persisted.** `swap-transactions-store` v1, profile: `groups` (all of the above per leg) and `quoteIdToGroup`.
   Decode at read is possible: the group phase can be computed from `state` plus leg statuses plus "is a run live in
   this session" (the runtime `useSwapStatusStore.active`), and the index recomputed from the legs, while
   `partialize` keeps writing both. The quote index must keep being written (0.1.3 `MonthlyChart` reads it).
7. **Consumers.** Group state 3 files, leg status 7, index 2 (`MonthlyChart`, `dataMigrations`).
8. **Pins.** `swapTransactionsStoreLegPatch`, `swapTransactionsStorePersistResilience`, `reconcileSwapLegs`,
   `transactionsSwapTimeline` (seeds `running` groups), `swapTransactionTotals`, `mintRebalanceRunLifecycle` (finish
   and cancel only). Pin first: a run that throws, a run aborted by a manager change, and `reconcileSwapLegs` on a
   `running` group with a `melting` leg.
9. **Recommendation: convert.** Transition table for the leg (the repo already has one shape of this in
   `features/mint/lib/rebalanceRunState.ts` and `wallet/src/rebalance/engine.ts`); group phase decoded as
   `Live | Ended(finished|cancelled) | Orphaned` with `Orphaned` = saved `running` and no live run; selector for the
   index instead of reading the stored copy. F139 (held steps) is the related open product question.
10. **Deletes.** The `stale` special case in `reconcileSwapLegs.ts:48`, three hand-written aggregates of leg statuses
    (row, screen, routing), the stored index as a source of truth. M.

## 3. Wallet restore phase (`wallet-lifecycle`)

1. **Files.** `shared/stores/global/walletLifecycleStore.ts:9-53,76-83,109-121`; `shared/blocks/AppGate.tsx:224-320`;
   `shared/lib/cashu/walletDatabaseRecord.ts:40-57`; `shared/providers/awaitRestoreReady.ts:4`;
   `features/payments/hooks/useDmEcashAutoRedeem.ts:92,321`; `features/nearPay/lib/nearbyPayments.ts:167-168`;
   `features/nearPay/lib/nutDropAutoRedeem.ts:36-39`; `shared/lib/cta/definitions.ts:39-43,61`;
   `shared/blocks/CtaHost.tsx:24,52`; `shared/lib/migrations/globalMigrations.ts:496-531`;
   `shared/lib/profile/profileSessionOrchestrator.ts:534-544` (hand-written blob).
2. **Variables.** `restoreStatus` (six strings), `seedCreatedAt` (null = "this install did not make the seed"),
   `lastRestoreAt`, `lastRestoreError`, plus hydration (`useWalletLifecycleHydrated`, a React-state copy of
   `persist.hasHydrated`).
3. **States.** `Unloaded`, `Unresolved` (`unknown`, and the stranded `in-progress`/`failed`), `RestoreRequired`
   (`pending`), `Settled` (`complete` | `not-needed`). Events: hydrate, gate evaluation (`pending`/`not-needed` from
   `seedCreatedAt`), lost database (`pending`), recovery flow (hand-written `pending`), restore done
   (`markRestoreComplete`).
4. **Meaningless.** `failed`/`in-progress` (no writer: `setRestoreStatus` callers pass `pending` or `not-needed`;
   `SettingsRecoveryScreen.tsx:233` says it never writes `in-progress`); `lastRestoreError` non-null (no caller
   passes an error); `lastRestoreAt` (written, never read outside the store and migrations).
5. **Reachable.** Old installs can still hold `in-progress`/`failed`; `RestoreGate` maps them to `Unresolved`
   (`AppGate.tsx:274-281`, pinned by `restoreGateStatusResolution`). The readers disagree on "settled": four
   (`awaitRestoreReady`, `useDmEcashAutoRedeem`, `nearbyPayments`, `nutDropAutoRedeem`) say complete|not-needed;
   `cta/definitions.ts:39,61` says "anything but `pending`", so `unknown` and `failed` count as settled there;
   `CtaHost.tsx:52` and `AppGate.tsx:299` block on `pending|failed`; `walletDatabaseRecord.ts:45` treats `failed`
   as already asking. Not a defect today because CTAs render under the gate, but four copies of one rule that
   already differ.
6. **Persisted.** `wallet-lifecycle` v1, global: `seedCreatedAt`, `recoveryPhraseVerifiedAt`,
   `recoveryPhraseVerifiedRevision`, `restoreStatus`, `lastRestoreAt`, `lastRestoreError`. Decoding at the read
   boundary keeps the enum written as is (`.catch('unknown')` stays) and maps the six strings to the four states;
   `profileSessionOrchestrator` and `globalMigrations` hand-write the blob and must keep doing so with the same
   strings.
7. **Consumers.** 11 files above.
8. **Pins.** `walletLifecycleTransitions`, `restoreGateDecision`, `restoreGateStatusResolution`,
   `lifecycleStampMigration`, `awaitRestoreReady`, `settingsRecoveryGateConfirmation`, `appGateOrder`,
   `releaseFixtureRestoreInFlight`. Pin first: the CTA rule for `unknown` and `failed`.
9. **Recommendation: convert** to a decoded `restorePhase()` with one `isRestoreSettled` used by all readers.
10. **Deletes.** Four local `restoreSettled` copies, the `failed` branches in CtaHost/AppGate/walletDatabaseRecord.
    M.

## 4. Payment routing context (runtime)

1. **Files.** `shared/stores/runtime/clearPaymentContext.ts:27-55`, `routstrTopUpStore.ts` (whole),
   `contactSendStore.ts`, `nearPayStore.ts`, `sendLockStore.ts`, `amountDraftStore.ts`, `pendingZapStore.ts`;
   `features/send/lib/sovranPaymentConfig.ts:881-912,986-1019,1096-1124`;
   `features/send/screens/AmountFlowScreen.tsx:328-329`; `features/send/screens/AmountSelector.tsx:350-361`.
2. **Variables.** `routstrTopUp.phase` (`idle|active|success|failed`) + `pendingMessage`; `contactSend.active`;
   `nearPay.active`; `sendLock.draft`; `amountDraft.pending`; module map `pendingByTarget`.
3. **States.** One send is routed to exactly one of `Ordinary`, `RoutstrTopUp`, `ContactDm(pubkey)`,
   `Nearby(session)`; the lock and amount draft decorate it. `sendComplete` picks by order: top-up first, contact
   second, then the hand-off screen.
4. **Meaningless.** More than one route set at once; `success`/`failed` top-up phase lingering into the next flow.
5. **Reachable.** **No production code calls `useRoutstrTopUpStore.getState().start()`** (grep over `app/` finds only
   tests and mocks), so `phase` is never `active`, `pendingMessage` is never set, and the top-up branch of
   `sendComplete` (`sovranPaymentConfig.ts:986-1019`, and `executeRoutstrTopUp` in `shared/lib/routstr/topUp.ts`)
   cannot run. The comment at `clearPaymentContext.ts:17-19` describes a flow that no longer exists. Contact and
   nearby cannot both be set by the shown paths (nearby binds to its operation, `:1096-1097`); a failed contact
   delivery leaves `contactSend.active` set on purpose until the next root clears it.
6. **Persisted.** No.
7. **Consumers.** Top-up phase 3 files, contact 3, nearby 5, lock 2.
8. **Pins.** `clearPaymentContext`, `paymentRootContext`, `routstrTopUp` (the function, not the store),
   `amountSelectorLock`, `sovranPaymentConfig.profile`.
9. **Recommendation: convert and delete.** One `paymentRoute` value (`ordinary | contact | nearby`) with the lock
   and draft as its fields, cleared by one call; ask the owner whether the AI top-up through Send is to come back
   before deleting the top-up store, its branch and `topUp.ts`.
10. **Deletes.** `routstrTopUpStore.ts` (44 lines), the 34-line branch, `topUp.ts` and its test if confirmed dead,
    the per-store clears. S.

## 5. Redeem queue entry (`nut-drop-redeem-queue`)

1. **Files.** `shared/stores/profile/nutDropRedeemQueueStore.ts:25-61,107-114,166-200,215-327`;
   `wallet/src/transport/redeemOrchestrator.ts:26,118-216`; `features/nearPay/lib/nutDropAutoRedeem.ts`;
   `features/nearPay/lib/nutDropStrikeState.ts:44,70-71`; `features/nearPay/hooks/useNutDropStrike.ts:11`;
   `features/payments/lib/parkedMessageEcash.ts:16,43,104,114`; `features/payments/lib/dmEcashRecovery.ts:50-96`;
   `features/payments/hooks/useDmEcashAutoRedeem.ts:73-77`; `features/payments/screens/MessageEcashMintScreen.tsx:50,74`.
2. **Variables.** `status`, `attempts`, `nextAttemptAt`, `lastError`, `source`.
3. **States.** `Due` (`pending`, `nextAttemptAt <= now`), `BackingOff(until)` (`pending`, later), `Redeeming`,
   `Redeemed`, `Spent`, `Parked(untrusted-mint)`, `Failed(exhausted | terminal)`. `redeeming` after a kill is
   recovered as `Due` (`redeemOrchestrator.ts:133-140`).
4. **Meaningless.** `Redeemed` with `lastError` (markStatus keeps an earlier retry's error, `:255`); `failed` with
   `attempts < 5` (orchestrator's non-retryable `failed`, `redeemOrchestrator.ts:210`) is indistinguishable from
   exhaustion except by `attempts`.
5. **Reachable.** Both, traced; harmless today: `lastError` has no reader outside the store.
6. **Persisted.** `nut-drop-redeem-queue` v1, profile: `byTokenHash` (every field above) and `recoveredCopy`. The
   union decodes from the saved fields as they are (status enum already `.catch('pending')`).
7. **Consumers.** 9 files, and the status union is spelled out three times (store, `redeemOrchestrator.ts:26`,
   `nutDropStrikeState.ts:44`).
8. **Pins.** `nutDropRedeemQueueStore`, `nutDropRedeemQueueOversize`, `nutDropRedeemQueueRecovery`,
   `nutDropStrikeState`, `dmEcashIntake`, `dmEcashRecovery`, `useDmEcashAutoRedeem`. Well pinned.
9. **Recommendation: convert** at the read boundary only (one exported union and `phaseOf(entry, now)`), after 1-3.
10. **Deletes.** Two duplicate status unions and the `LIVE_STATUSES` sets. M (crosses the wallet package).

## 6. Store load verdict (`shared/lib/persist`)

1. **Files.** `shared/lib/persist/preserveUnreadable.ts:43-126` (closure `raw`, `readFailed`, `rejected`,
   `preserving`, `refusalLogged`, `generation`); `persistConfig.ts:299-355` (`loads`, `loadTurnedDown`, the
   recovery gate); `hydrationOutcome.ts:8-45` (module `failed` set beside zustand's `hasHydrated`);
   `shared/stores/global/settingsStore.ts:12-17,557-558` (`useSettingsHydration.status`, a third copy);
   `walletLifecycleStore.ts:109-121`; and 21 files that hand-roll `persist.hasHydrated()`/`onFinishHydration` waits
   (`CtaHost`, `AppGate`, `vertexBudgetStore`, `mockDataStore`, `routstrStore`, `dataMigrations`,
   `walletDatabaseRecord`, `profileScopedStorage`, `inProcessProfileSwitch`, `moderation`, `refreshVertex`,
   `useMuteListSync`, `useDmConversations`, `useDmEcashAutoRedeem`, `useDmThread`, `useNostrSignerService`,
   `useSignerApprovalController`, `ProviderListScreen`, `AiChatScreen`, and the two persist files).
2. **Variables.** Per store: zustand `hasHydrated`, `failed.has(name)`, guard `readFailed/rejected/preserving`,
   persistConfig `loadTurnedDown`, and two load counters (`generation`, `loads`) bumped by different hooks.
3. **States.** `Loading`, `Loaded`, `LoadedRejected(preserve: pending|done|failed)`, `ReadFailed`. Events:
   `getItem`, `merge` reject, rehydrate error, write, re-read under another profile.
4. **Meaningless.** `loadTurnedDown` true with guard `rejected` false (they are set together only through
   `turnDown`); `rejected` with `raw === null` (guarded by `typeof raw === 'string'`).
5. **Reachable.** None found; the two flags are kept in step by `turnDown()` alone. F208 (a second rejected blob is
   not copied when an older copy exists, `preserveUnreadable.ts:66`) is the open defect here.
6. **Persisted.** No (closure and module state).
7. **Consumers.** 21 files for hydration waits; the guard is internal.
8. **Pins.** `persistUnreadableGuard` (15 cases), `hydrationOutcome`, `createMergeWithSchema`,
   `persistRoundTrip`, `releaseUpgrade`, `nutDropRedeemQueueRecovery`. Strong.
9. **Recommendation: convert** to one `loadState(name)` union owned by `persistConfig`, exposed as
   `useStoreLoaded(store)` / `whenLoaded(store)`; the guard reads the verdict instead of keeping its own flags.
10. **Deletes.** `loadTurnedDown`, the second counter, `useSettingsHydration`, `useWalletLifecycleHydrated`, about
    20 hand-written subscriptions. M.

## 7. Consent and onboarding (`settings-store`)

1. **Files.** `shared/stores/global/settingsStore.ts:85-87,141-146,198-208,396-416,506-515`;
   `shared/blocks/AppGate.tsx:133-139,159-196`; `features/onboarding/screens/TermsAndConditionsScreen.tsx:32`;
   `features/feed/lib/appNotificationRows.ts:29-42`; `shared/lib/migrations/globalMigrations.ts:459,521-525`;
   `shared/lib/profile/profileSessionOrchestrator.ts:449,567`.
2. **Variables.** `termsAccepted: {termsAccepted, date} | null`, `legalAcceptance: {termsRevision, privacyRevision,
   acceptedAt} | null`, `hasSeenOnboarding`.
3. **States.** `NeverAccepted`, `AcceptedLegacy(date)` (pre-revision record only), `AcceptedOutdated`,
   `AcceptedCurrent`, each × onboarding seen/not.
4. **Meaningless.** `{termsAccepted: false, date}`; `legalAcceptance` set with `termsAccepted` null (one field
   `.catch(null)`ed). `isTermsAccepted()` (`:410`) reads only the legacy record and has no caller; the gate uses
   `hasCurrentLegalAcceptance(legalAcceptance)`.
5. **Reachable.** The `.catch(null)` combination only from a damaged blob; `AcceptedOutdated` + seen is real (a
   revision bump re-asks). F207 lists AppGate writing `hasSeenOnboarding` during render.
6. **Persisted.** `settings-store` v4 (independent fields): the three fields above. Decodes at read without change.
7. **Consumers.** 6 files.
8. **Pins.** `settingsStoreSetters`, `settingsStorePersistResilience`, `appGateOrder`,
   `appGateReinstallDetection`, `migrateThenLoad`.
9. **Recommendation: convert** (a decoded `consentState()`), delete `isTermsAccepted`. S.
10. **Deletes.** `isTermsAccepted`, three ad hoc readings (`acceptedBefore`, notification rows, gate). S.

## 8. Relay list provenance (`nostr-relay-list-store`)

1. **Files.** `shared/lib/nostr/outbox/relayListStore.ts:21-30,59-66,102-138`; 6 consumer files.
2. **Variables.** `source` (`default|relay|local`), `updatedAt`, `hasPublished`, `entries`.
3. **States.** `Default`, `Synced(at)`, `EditedUnpublished(base at)`, `Published(at)`.
4. **Meaningless.** `source:'relay'` with `hasPublished:false` (writers set both); `local` that an older relay list
   may overwrite.
5. **Reachable.** The overwrite: `setFromRelay` only refuses an older list when `source === 'relay'`
   (`:107`), so unpublished local edits lose to any relay list. Filed as F203 item 1 (pinned in
   `useOwnRelayListSync.test.tsx`).
6. **Persisted.** v1, profile: all four fields; decodes as is.
7. **Consumers.** 6 files.
8. **Pins.** `useOwnRelayListSync`, `relayListStoreAddLimit`, `releasedWriterBounds`.
9. **Recommendation: convert** (decode), together with the F203 repair. S.
10. **Deletes.** The `source` comparisons in callers. S.

## 9. Payment status toast (`usePaymentStatusStore`)

1. **Files.** `shared/stores/runtime/paymentStatusStore.ts:6-26,66-207`; 9 consumer files (listener, popups,
   `nutDropAutoRedeem.ts:109-159`, others).
2. **Variables.** `active.state`, `active.variant`, `errorMessage`, `operationId`, `receiveEntryId`,
   `titleOverride`/`subtitleOverride`.
3. **States.** `None`, `Processing`, `Delivered`, `Waiting` (absorbing for this toast), `Confirmed(extra)`,
   `Failed(message)`. Each setter repeats its own guard (`:104-111,130-140,152-168,183-193`).
4. **Meaningless.** `failed` without `errorMessage`; overrides on a non-waiting state; `operationId` on a non-melt.
5. **Reachable.** `setActive` takes any state and replaces a live toast of another id without a check (`:66-87`).
6. **Persisted.** No.
7. **Consumers.** 9.
8. **Pins.** `paymentStatusStore`, `paymentStatusListener`, `paymentStatusToastSelectors`, `paymentToastGating`.
9. **Recommendation: convert** to a transition table (event × state → state); S.
10. **Deletes.** Four hand-written guard blocks. S.

## 10. Routstr credential and session mirror (`routstr-store`)

Files `shared/stores/profile/routstrStore.ts:365-547,653-689,1195-1249,1305-1318,1417-1631,1738-1765`.
`apiKey`/`balance`/`nodeBaseUrl`/`userNodeBaseUrl`/`legacyAccounts` encode which node a credential belongs to; the
two move paths (`setServerLineup`, `setUserNode`) archive the old key in the same `set`. `authMode` is written
(`:1098,1468,1740`) and read by nothing outside the store. `conversationHistory`/`activeChildren` are runtime mirrors
of `sessions[currentSessionId]`, kept in step by `withSessionMirror`/`mapSessionMessages`, with anonymous mode as a
third case. Persisted v3 (secrets in the secure vault). No illegal state found reachable in the time spent.
**Defer** to pass 3: the store is 1,852 lines and wants splitting before any state work; note `authMode` as a
write-only saved field.

## 11. Mint liveness triple (`mint-metadata-store`)

`shared/stores/global/mintMetadataStore.ts:162-166,315-330,340-347`; readers `shared/lib/cashu/mintHealth.ts:55-56`
and `features/mint/lib/mintLiveness.ts:24-28` each re-check "liveness and a numeric livenessAt within my TTL" with
different TTLs. Each of the three fields has its own `.catch(undefined)`, so a blob can decode to a status with no
time. Persisted v1 global: `liveness`, `livenessAt`, `livenessSource`. **Convert** (decode to
`{status, at, source} | undefined` in one helper), S. The other metadata groups (`identityAt`, `reviewsAt`, `auditAt`,
`socialAt` beside their data) are the same shape and lower value.

## 12. Vertex budget sentinels (`vertex-budget-store`)

`shared/stores/profile/vertexBudgetStore.ts:12-16,34-50`: `day: ''` means "never used", and a value that does not
parse becomes `'9999-12-31'` (day and `blockedUntilDay`). Pinned by `vertexBudgetStore.test.ts`. **Leave** the
shape; D5 is the one thing to fix.

## 13. CTA presentation (`cta-store`)

`shared/stores/global/ctaStore.ts:9-56`, `shared/blocks/CtaHost.tsx:29-104`, `shared/blocks/CtaScreen.tsx:34-36`.
`activeId`, `closingId`, `previewOverride`, `previewSeq`, `backupStartedAt` are runtime only (partialize saves
`dismissed` alone, keyed `<id>` or `<id>:snooze`). `preview` clears the other two to escape "stranded" states, which
says the states overlap. **Defer**: display only, pinned by `ctaHost`, `ctaPersistence`.

## 14. Account kind (`profile-store`)

`source` (absent = derived), `externalChain` (stored, but derivation reads `source` only:
`shared/providers/CocoProvider.tsx:227`; the only reader of `externalChain` is the details screen,
`features/settings/components/ProfileDetailsScreen.tsx:98`), `walletPhraseFingerprint` (imported only, enforced by
`recordWalletPhraseFingerprint`). Persisted v2 global. No reachable illegal combination found; **leave**.

## 15. Small runtime pairs (leave)

- `legProgress.ts:79-160`: terminal states are not absorbing (a `complete` after `fail` wins) and a leg keeps an
  earlier `errorMessage` after a later `done` (`setLeg` only writes it when given). See D6.
- `rollbackStore.ts`: `inFlight` and `collapsing` sets; `start` during collapse puts an id in both. Display only.
- `nfcTapStore.ts`: `armed` boolean and a `phase` whose rest value is also called `armed`.
- `nearPayStore.ts`: `phase` with `amountEntry` null in `amount` (via `showAmount`); belongs to the payments survey.
- `npcMintStore.ts:17,72`: `isSyncing` has no reader or writer besides the initial value. See D4.
- `popupStore.ts`: `current`/`isOpen`/`openSeq`/`destroyed`; already made safe by the nonce
  (`popupStorePresentationNonce.test.ts`).

---

## Defects

### D1. A follow publishes a contacts list the app does not have, replacing the person's follows on relays

- **Where.** `features/user/screens/UserProfileScreen.tsx:1081-1094` builds the new kind-3 from `contactsTags`;
  `shared/stores/profile/nostrSocialStore.ts:449-470` lets the follow set and stamp move without the document;
  `shared/lib/nostr/ownsync/useOwnEventsSync.ts:89-90` asks for kind 3 with `since = now - 1 year`.
- **Path.** Fresh install or new device, account whose kind-3 is older than a year (or relays slower than nagg):
  `useOwnSocialGraphSeed` seeds `followingPubkeys` and `contactsUpdatedAt`; `contactsTags` stays `[]`. The person
  opens a profile and taps Follow: `nextTags = [['p', target]]`, published with `resolveOn: 'all-settled'`, then
  `setContactsFromRelay` makes it the local truth. Every earlier follow is gone, on relays and here. Same with stamp
  0 (nothing loaded yet). With `DocumentBehind`, follows added on another client since the old document are dropped.
- **Test idea.** Seed via `seedFollowsFromFacade({follows:[a,b], createdAtSec:T})`, call the follow toggle for c:
  the published tags must contain a, b and c (fails today: only c).
- **Touches stored data / wire.** Wire: yes, the repair changes what may be published (refuse or fetch first). Stored
  shape: no (an optional additive stamp is optional). Not in `docs/follow-ups` (F203 covers other own-sync cases).

### D2. A rebalance that throws, is aborted or is killed leaves its swap group `running` for ever

- **Where.** `features/mint/hooks/useMintRebalanceOrchestrator.ts:214` (`aborted` returns before
  `finalizeGroup`), `:248-253` (catch fails the toast, not the group), `:115-119` (`isRunActive` false once the
  Manager changes); `shared/lib/cashu/reconcileSwapLegs.ts:48` (only reconciles `melting`/`verifying` legs of a group
  that is not `running`); `features/transactions/components/SwapTransactionRow.tsx:30`.
- **Path.** Start a rebalance; switch account (Manager changes → engine returns `aborted`), or the engine throws, or
  the app is killed mid-run. The saved group keeps `state: 'running'`. History shows it "Pending" for good; its legs
  left at `melting`/`verifying` are never reconciled, so a paid melt never reads as settled or failed.
- **Test idea.** In `mintRebalanceRunLifecycle`, make `start` reject: expect `finalizeGroup(…, 'cancelled')` (fails
  today: not called). For `reconcileSwapLegs`: a `running` group with no live run and a `melting` leg whose melt is
  finalized must move to `settling`.
- **Touches stored data.** Writes existing enum values into the saved group; no shape change. Not filed (F139 is
  about held steps, not orphaned groups).

### D3. A follow interrupted by an app kill disables that person's Follow button for good

- **Where.** `shared/stores/profile/nostrSocialStore.ts:474-482,491-507,725` (pending optimistic follow is saved,
  and `clearSettledFollowOptimistic` keeps every `pending` entry); `features/user/screens/UserProfileScreen.tsx:1076,1289`
  (`followInFlight` makes `toggleFollowContacts` return early).
- **Path.** Tap Follow; kill the app before `publishEvent` settles. On the next launch the entry loads with
  `pending: true`; nothing clears it (no `afterHydrate`, no age check); the button stays in flight and every tap is
  ignored. Likes and reposts have a reconciler (`features/feed/hooks/useNostrEngagement.ts:256-259`); follows do not.
- **Test idea.** Persist `{optimisticFollowsByPubkey: {pk: {value: true, pending: true, updatedAt: 1}}}`, rehydrate,
  call `clearSettledFollowOptimistic`: the entry should be gone or not pending (fails today).
- **Touches stored data.** Read-side only (treat a loaded `pending` as settled); no shape change. Not filed.

### D4. Changing the npub.cash mint, then switching account before the server answers, records it on the other account

- **Where.** `shared/stores/profile/npcMintStore.ts` `updateServerMint` (awaits `client.settings.setMintUrl`, then
  `set({ mintUrl })` with no owner check; the profile-scoped adapter resolves the key at write time).
- **Path.** Account A sets a new receive mint on a slow network; the person switches to B; the answer lands and B's
  saved `mintUrl` becomes A's choice, while B's server setting is unchanged. Same class as F180 (standing quotes).
- **Test idea.** Start `updateServerMint` with a held promise, change the active profile, resolve: B's store must
  not change. Traced, not run.
- **Touches stored data.** No shape change (an owner check). Could be folded into F180.

### D5. A Vertex budget day the reader cannot parse turns Vertex lookups off for that account for good

- **Where.** `shared/stores/profile/vertexBudgetStore.ts:13-15` (`.catch('9999-12-31')` on `day` and
  `blockedUntilDay`), `:38-40,48-49` (nothing ever lowers either).
- **Path.** Only a blob no release wrote (a newer build's format, or corruption): `reserve()` then returns false
  until the year 9999. Fail-closed is intended; having no way out is not stated anywhere.
- **Test idea.** Load `{day: 'garbage'}`; `reserve()` on the next real day should be allowed after one day, or at
  least after a reset (fails today).
- **Touches stored data.** The repair changes read tolerance (persisted-schema rule applies: keep `.catch`, change
  only the fallback or add a reset). Not filed.

### D6. Small runtime leftovers

- `shared/stores/runtime/legProgress.ts:79-88,124-156`: a leg retried after `failed` keeps its old `errorMessage` once
  `done`; a terminal run state can be overwritten by another terminal call. Display only. F187 covers the swap toast
  latch.
- `features/send/lib/sovranPaymentConfig.ts:986-1019`: unreachable branch (candidate 4), not a behaviour bug.

Already filed and not repeated: F203 (relay list overwrite, own profile sync), F208 (second rejected blob), F207
(AppGate writes onboarding during render; `resume()` never settles), F139 (held swap steps), F180 (standing quotes
across a switch), F113/F72 (whole-blob rejection, unread side copies), F48 (unbounded collections).

## What a conversion needs pinned first

- D1/D3 and candidate 1: no test names `seedFollowsFromFacade`, `toggleFollowContacts` or follow `pending` on load.
- Candidate 2: the throw and abort paths of a rebalance run, and `reconcileSwapLegs` on a `running` group.
- Candidate 3: the CTA definitions' reading of `unknown` and `failed`.
- Candidate 4: an owner decision on whether the Routstr top-up through Send is gone.

## Not read

- `routstrStore.ts` lines 700-1190 (schema, migrations, bounding) beyond grep; `features/ai` and
  `shared/lib/routstr/*` except `reclaim.ts:228-290` and `topUp.ts` callers.
- `wallet/src/legacy-ecash/*` state (the `legacy-ecash-store` only holds wallet-owned records: status, tallies,
  `claiming`, `attempts`/`nextAttemptAt`; left to the wallet survey).
- `features/nostrSigner/data/nip46ConnectionsStore.ts`, `nip46RequestsStore.ts`, `nip46ActivityStore.ts`;
  `features/feed/stores/ignoreStore.ts`, `notificationPolicyStore.ts`; `features/composer/state/composerStore.ts`;
  `features/theme/lib/themeDraft.ts`; `features/bitchat/stores/bitchatDmMessages.ts` beyond its status rank (its
  quirks are in the ledger); `shared/lib/profile/ownProfileStatsStore.ts`; `shared/lib/nostr/media/mediaServerStore.ts`.
- `mintDistributionStore`, `transactionDistributionStore`, `transactionAnnotationStore`, `transactionLocationStore`,
  `themeStore`, `ownProfileMetadataStore`, `aiProviderDirectoryStore`, `recentPeopleStore`, `searchHistoryStore`,
  `scanHistoryStore`, `dmLastMessageStore`, `dataMigrationStore`, `wallpaperStore`, `btcMapStore`, `pricelistStore`,
  `mintTestnutStore`, `nostrMetadataCache`, `relayMetadataStore` (its `status` is already decoded at read,
  `:216-224`): schemas skimmed by grep for status fields only.
- Runtime `mockDataStore`, `deleteStatusStore`, `dmEchoStore`, `debugTierStore`, `detailsSheetStore`,
  `pickerSheetStore`, `notePickerStore`; `secureVault.ts` beyond its manifest schema; `storageUsage.ts`,
  `fileCacheStorage.ts`, `tolerant.ts`, `defineStore.ts`.
- `NearPayScreen.tsx` use of the session phase; `MintRebalancePlanScreen.tsx`.
- No test was run, nothing on a device.
