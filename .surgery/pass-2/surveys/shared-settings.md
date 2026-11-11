# Pass 2: shared code and settings

Checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery`, HEAD `26ef519bc5d5c77fa574b6e23a535b1cff5a807b`.
Started from `pass-0/surveys/shared.md` and checked `.surgery/LEDGER.md` against current source and tests. Product code unchanged. No network, jg, or helpers. Paths below are checkout-relative; `hooks/`, `blocks/`, `lib/`, and `ui/` abbreviate `app/shared/`; `settings/` and `theme/` abbreviate `app/features/`. Test basenames mean `app/__tests__/`.

Ranking weighs reachable inconsistent states and money/saved-data consequences against conversion cost. A representable combination is not automatically a bug. “Traced” means source control flow; “run” means observed this survey. Consumer counts count production files that directly consume the named lifecycle, not transitive UI users or generated manifests. Supporting stores outside this assignment were read only to establish the boundary; their implementation belongs to the store survey.

**Verification:** ran only `cd app && bun run test -- paymentStatusListener.test.tsx --runInBand`: 1 suite, 15 tests passed. It emitted `store.profile.rehydrate_failed` (`getItem` unavailable in the test environment). This confirms the event-handler assertions, not durable hydration. Other tests below were inspected or located, not run; the ledger's older execution evidence is not a new run. No native/device verification.

## 1. Recovery run ownership — convert, M

**Files/ranges:** `settings/screens/SettingsRecoveryScreen.tsx:63-99,145-201,203-608`; `settings/lib/recoveryProgress.ts:21-80` (phase and row model); `blocks/AppGate.tsx:299-315` (gate completion); `ui/composed/SlideToConfirm.tsx:49-82` (start latch). The called cashu restoration implementation is explicitly outside this survey.

**Representation:** module `recoveryInFlight` and `recoveryCancelled`; component `phase`, `results`, `errorMessage`, `finalizingLabel`; discovery `deepProbe/isDiscovering/discoveredMintUrls`; mutable `recoveryResults` indexed alongside `allMintUrls`. Each row has `status`, nullable counters/times, optional error, and `fundsFound`.

**States/events:** idle → discovering → restoring → finalizing → complete/partial/error; Start, probe completion, keyset completion, mint timeout, Stop, cleanup completion, Retry, gate Continue. A separate discovery-fetch lifecycle supplies the Start prerequisites.

**Illegal/reachable:** terminal run with a still-writing restore; failed mint row subsequently becomes done; new mount looks idle while the module lock says running. **Traced:** `withTimeout(restoreOneUrl(...))` at 448-452 does not cancel the passed promise; catch patches failed, finalization ends and 591 releases the lock, then the old `restoreOneUrl` reaches 411 and patches its row. Retry can start while it still works. Remount retains the module lock but loses the displayed results; no reconnect path binds the new view to the run. Existing F178 covers the timeout and gate dead ends; do not create another follow-up.

**Persisted:** these phase variables are not. Recovery calls mutate Coco proofs/counters/mint trust and delete pending mint operations; gate Continue writes `wallet-lifecycle.seedCreatedAt`, `restoreStatus`, `lastRestoreAt`. Convert only the runtime controller; retain all saved shapes. No new persisted run representation is necessary for this pass.

**Consumers:** three direct lifecycle sites: screen, `recoveryProgress.ts` selectors, AppGate completion callback. Slider consumes only Start, not results. **Pins:** `settingsRecoveryRun.test.tsx`, `settingsRecoveryGateConfirmation.test.tsx`, `recoveryProgress.test.ts`, `recoveryDiscovery.test.ts`; run tests explicitly pin timeout/late-write/retry quirks. Before conversion pin remount attachment, cancel during probe/keyset, cleanup failure, and completion after timeout with a second run active.

**Cut:** an owned async run machine with run identity, cancellation intent, outstanding-work tracking, and terminal outcome; row discriminated unions. Follow the existing `wallet/src/machine` approach for owned async steps; `recoveryProgress.ts` already supplies selectors and cites the rebalance reducer precedent. A union alone cannot cancel underlying wallet work. Delete the two module booleans, independent terminal error/label setters, unrestricted `Partial<MintRecoveryState>` transition patches, and repeated phase guards. M, roughly 3–6 files; no stored-data redesign.

## 2. Payment toast ownership and terminal matching — convert, M

**Files/ranges:** `hooks/usePaymentStatusListener.ts:361-918` (nine subscriptions, especially 653-706,708-759,761-827,829-901); `app/shared/stores/runtime/paymentStatusStore.ts:6-36,103-208`; `lib/popup/popups/payment.ts:20-65`; `lib/popup/PaymentStatusToast.tsx:227-414` (presentation). External initial producers are `app/features/send/lib/sovranPaymentConfig.ts` and `app/features/nearPay/lib/nutDropAutoRedeem.ts`; their payment orchestration was not audited here.

**Representation:** active nullable record with independent `variant/state/id/mintUrl/amount/unit/operationId/receiveEntryId/errorMessage`, plus whether a toast exists and whether a swap owns the surface. Identity alternates between temporary UI ID, quote ID, operation ID and history ID.

**States/events:** absent → processing → delivered/waiting → confirmed/failed → dismissed; mint paid/finalized, receive finalized/history arrived, send finalized, melt rolled back/finalized, dismiss, swap suppression. Waiting receives intentionally get a fresh terminal toast; failed/waiting are refused by `setConfirmed`.

**Illegal/reachable:** toast A's amount/mint with operation B's View target; payment-request A confirmed by unrelated send B. **Run:** `paymentStatusListener.test.tsx:368-412,479-520` exercises both. The melt branch checks only variant and phase at 858-860, then merges B's `operationId` into A at 870. The send fallback at 728-729 similarly accepts any processing/delivered payment-request. A `failed` record with no reason is type-legal, but normal `setFailed` fills its reason; do not claim that branch reaches confirmed with a leftover failure because `setConfirmed` refuses failed.

**Persisted:** paymentStatusStore is session-only. Listener side effects also update `transaction-annotation-store.annotations['quote:<id>'/'op:<id>']` and mint standing-quote records; leave these formats and rotation behavior intact. Runtime conversion needs no stored schema change.

**Consumers:** six direct producer/consumer files outside the store: listener, PaymentStatusToast, popup/payment, sovranPaymentConfig, nutDropAutoRedeem, `lib/profile/profileTransition.ts` (reset). **Pins:** `paymentStatusListener.test.tsx` (run), `paymentStatusToastSelectors.test.tsx`, `paymentToastGating.test.ts`. First pin concurrent operations with equal amounts, same quote text on different mints, late receive history, dismiss/replacement, and swap overlap. Explicitly change the two QUIRK assertions when fixing ownership.

**Cut:** discriminated runtime toast states carrying one explicit owner and a reducer/event matcher. Reuse wallet operation identities; do not build another payment engine. Delete variant-only/amount-only matching, scattered ID reinterpretation and optional terminal payload bags. M, 5–8 files. Pass 0's hard-coded-sat defect is already repaired (`operation.unit` at 710 and 874); the old test title still says sats but its assertion expects usd.

## 3. Accelerator invoice and polling lifetime — convert, S

**Files/ranges:** `hooks/useMempoolAcceleration.ts:54-197`; sole production consumer `app/features/send/screens/OnchainSendScreen.tsx:189` and its subsequent acceleration actions.

**Representation:** `offerState`, `acceleratingTxid`, `estimateRef`, `invoiceRequestRef`, `statusPollRef`, props `enabled/txid/quoteId/alreadyAccelerated`, plus effect-local `mounted` and poll-local deadline.

**States/events:** disabled → checking → unavailable/offered → creating-invoice → awaiting-ack → acknowledged/expired; enable, parameter change, estimate result, Request, invoice result, timer, status result, cleanup.

**Illegal/reachable:** disposed/disabled watcher owns a newly created timer; old transaction completion replaces the new transaction's poll; acknowledgement writes after cleanup. **Traced:** Request invoice A → leave/change txid (125-127 clears only an existing timer) → A invoice resolves → 152-170 starts a timer with no mounted/generation guard. If B already polls, A calls `stopStatusPoll` against that shared ref first. Likewise a status fetch begun before cleanup can still call `markAccelerated` at 164. Estimate responses *are* protected by the effect's mounted guard; invoice/status responses are not.

**Persisted:** runtime phase is transient; acknowledgement writes `transaction-annotation-store.annotations['quote:<quoteId>'].onchainAccelerated` through the structured `onchainMelt.accelerated` patch. Keep that shape; key the runtime session by quote and txid. No wire change.

**Consumers:** one screen. **Pins:** `useMempoolAcceleration.test.tsx` covers estimate, concurrent invoice deduplication, cadence, deadline and unmount *after* invoice creation. First pin unmount during invoice creation, parameter switch with A/B completions reversed, and pending status completion after disable.

**Cut:** local async lifecycle controller with generation identity and owned timers, exposing an offer/invoice/acknowledgement union. Reuse existing single-flight conventions, but add cancellation ownership beyond deduplication. Delete the independent estimate/promise/timer ownership checks and mismatched effect/callback cleanup. S (hook; associated tests).

## 4. Onchain quote polling and verdict — convert, M

**Files/ranges:** `hooks/useOnchainMeltQuote.ts:36-227,268-334`; `hooks/useOnchainMeltOutpointDiscovery.ts:22-79,95-120`; consumer `app/features/send/screens/OnchainSendScreen.tsx:105,176`. Excluded `lib/cashu/onchainMelt` supplies the existing settlement transition helper; its internals were not read.

**Representation:** interval, confirm timeout, `mounted`, `awaitingVerdict`, failure count, settlement accumulator; three annotation-once refs; React `storedQuote/watched/isLoading/offchainSettled`; persisted verdict input. Discovery has separate timer/mounted state and reads the same annotation.

**States/events:** idle → polling → confirming-no-outpoint → retry-wait → offchain-settled/onchain-found/expired-unpaid/retry-exhausted; tick, refresh result/error, retry deadline, annotation arrival, quote change, cleanup.

**Illegal/reachable:** `isLoading=false` with another refresh outstanding, multiple reads occupying a nominally single verdict step. **Traced:** refresh A takes longer than 12 seconds → interval starts B → A's finally at 210 clears loading while B remains pending. There is no in-flight guard. Reordered snapshot risk needs a test with the actual manager's PAID-sticky merge before claiming a terminal rollback. A quote change is protected by the `watched` key and `mounted` checks. Retry exhaustion is intentional and documented, not an unexplained dead end. Discovery checks existing outpoint both before and after its await and refuses stale writes after unmount; leave that small watcher unless integrating it removes duplicated ownership.

**Persisted:** `transaction-annotation-store.annotations['quote:<id>']`: flat `onchainOutpoint`, `onchainOutpointSource`, `onchainSettledOffchain`, `onchainAddress`, `onchainAmountSats`. An outpoint and historical offchain verdict may coexist; consumer precedence already handles that, so do not tighten the saved record. Decode facts into a runtime observation state.

**Consumers:** one screen consumes both watchers; hook internally owns loading and annotation writes. **Pins:** `useOnchainMeltQuote.test.tsx`, `useOnchainMeltOutpointDiscovery.test.tsx`. Add deferred refresh longer than cadence, reversed responses, annotation-once writes, failed annotation write, and mint/outpoint versus heuristic race.

**Cut:** timer-owning transition controller (existing `wallet/src/machine` is a pattern, not a reason to add a dependency), retaining the settlement helper. Delete `awaitingVerdict`, loose timer/phase combinations and boolean loading writes; derive loading from current owned request. M, 2–4 files.

## 5. Theme draft apply versus cancel — convert, M

**Files/ranges:** `theme/lib/themeDraft.ts:26-58,120-237`; `theme/screens/ThemePreviewScreen.tsx:100-129,154-180`; `ui/composed/ButtonHandler.tsx:134-153,212,266-309`; saved boundary `app/shared/stores/profile/themeStore.ts:83-110`.

**Representation:** draft `active/activeAlbumSlug/unitWallpapers/mode`, implicit in-flight `commit` promise, wallpaper download state, per-button loading index. No committing or cancelled generation exists.

**States/events:** inactive → editing → preparing-primary → applying → closed; Begin, Edit, Reset, Apply, download result, Cancel. **Illegal/reachable:** discarded draft still commits; old commit clears a newer draft. **Traced:** Apply captures A at 190 and awaits at 204 → Cancel calls `discard()` at screen 121 → A continues to saved-store write at 209 and clears the current draft at 236. ButtonHandler's single-flight is per button; Cancel is not disabled by Apply's loading index. This trace does not require two Apply taps. An unsuccessful download being saved is existing F189, not a new report.

**Persisted:** draft itself is session-only `useThemeDraft`; writes profile `theme-store.activeAlbumSlug/unitWallpapers/mode`. Keep the saved keys and fields. Runtime conversion can keep the saved shape unchanged; no migration required.

**Consumers:** three screen files: ThemePreviewScreen, BackgroundScreen, GalleryScreen. **Pins:** `themeDraftCommit.test.ts` pins ordinary commit/discard and failed primary download. Add Apply→Cancel→download completion, old Apply→new draft→completion, and rejection without leaving the editor.

**Cut:** discriminated draft state with revision/commit ownership and an explicit Cancel transition; reuse ButtonHandler but expose transaction-wide state. Delete independent active/reset bookkeeping and unconditional post-await commit/reset. M, 2–4 files. Whether Cancel aborts preparation or is disabled during Apply is a product decision; it must not silently save a discarded draft.

## 6. Delete confirmation versus deletion outcome — convert, S/M

**Files/ranges:** `settings/screens/DeleteScreen.tsx:20-35,108-125`; `ui/composed/SlideToConfirm.tsx:24-25,49-82,100-102`.

**Representation:** UI-thread `isComplete`, JS `confirmed`, implicit deletion promise and ignored boolean return. **States/events:** armed → confirming → deleting → deleted/refused/failed; drag/accessibility activate, delete resolution/rejection, cancel. **Illegal/reachable:** refusal with permanently spent slider and completion log. **Traced:** `await deleteAllProfiles()` returns false at DeleteScreen 24, 25 logs success, slider never resets. Already F177; recovery's same slider issue belongs to F178. The mirrored animation/accessibility flags by themselves are an intentional thread boundary.

**Persisted:** UI state is not saved. Deletion service is out of this survey; conversion must not change its storage erasure order or return contract. **Consumers:** two task-relevant users of the confirmation lifecycle: DeleteScreen and SettingsRecoveryScreen; slider itself consumes only a void action. **Pins:** `deleteScreen.test.tsx`, `settingsRecoveryRun.test.tsx`. Pin a real slider's refusal→retry and promise rejection, not just a mocked `onConfirm` callback.

**Cut:** explicit deletion outcome state in the screen and controlled reset/disable on the shared slider. Do not make the slider own wallet deletion. Delete the ignored result and unconditional completion log; S if remounting on refused outcome is sufficient, M for a shared controlled API.

## 7. Swap toast handoff — convert, M

**Files/ranges:** `lib/popup/popups/payment.ts:84-113`; `lib/popup/popups/bridge.ts:159-177`; `hooks/useSwapStatusListener.ts:7-41`; store boundary `app/shared/stores/runtime/swapStatusStore.ts:1-45`; view `lib/popup/SwapStatusToast.tsx:1-113`.

**Representation:** module `swapToastMounted`, host registration, nullable swap active/state, listener `prevState`. **States/events:** absent/running-visible/running-dismissed/terminal-visible/cleared; Start, host accept/refuse, Hide, run terminal, repop. **Illegal/reachable:** mounted flag with no accepted toast. **Traced conditional entry:** call popup with no host → 95 sets flag → bridge 175 returns → every later call skips. Whether production startup can call before registration remains unproven; F187 already owns that investigation. Normal running dismissal intentionally retains the payment gate.

**Persisted:** all runtime. **Consumers:** three direct lifecycle consumers: popup/payment, useSwapStatusListener, SwapStatusToast. Runner/start callers are outside this trace. **Pins:** `swapStatusPopupLifecycle.test.ts`; add real bridge refusal/registration, host teardown, and listener mount with an already terminal run.

**Cut:** host-accepted toast handle plus explicit visible/dismissed state, not a guessed mounted flag; keep swap progress in its existing owner. Delete module boolean as an unacknowledged mirror and duplicate visibility inference. M, 3–4 files.

## 8. Cached-read fetch/error projection — convert, S

**Files/ranges:** `lib/read/useCachedRead.ts:156-226,228-388,430-443`. Cache store remains authoritative; this candidate only changes the hook's transient request projection.

**Representation:** independent `flight/failure/seedState/lastKeyWithData/abortRef/focusedKeyRef`; derived status/source/data. **States/events:** disabled, cold-loading, seeded, cached, refreshing, failed-with/without-data, partial, ready, aborted; focus, key/viewer change, partial, completion, failure, refresh, blur/unmount.

**Illegal/reachable:** aborted request still represented as fetching; retry exposes previous error alongside a live flight. **Traced:** catch sets failure at 329; refresh sets flight but never clears failure until success at 297, so cold retry continues to report status error at 387. Keeping old error during retry may be intentional; classify it explicitly. For `abortOnBlur=true` plus `focusRevalidate=false`, blur aborts, finally skips clearing flight at 332, refocus does not start another request: stale fetching can persist. This is reachable through the hook API; no current production caller using that exact option combination was established. Viewer-key guards and request-ID checks protect several other invalid combinations; do not remove them casually.

**Persisted:** transient projection is not saved; generic caller cache persistence is out of scope. Retain cache entry shape/viewer guard. **Consumers:** seven invocation files: `features/payments/hooks/useContactSearch.ts`, `features/mint/hooks/useMintSearch.ts`, `features/mint/hooks/useMintChanges.ts`, `features/mint/screens/MintReviewsScreen.tsx`, `features/contacts/components/SearchPostsList.tsx`, `features/feed/components/UserFeed.tsx`, `features/feed/hooks/useNotificationsPage.ts` (all under app).

**Pins:** `useCachedRead.test.tsx` and `useCachedReadCompiledHooks.test.ts`. Add cold retry, disabled midflight, blur/refocus option combinations and viewer switch during seed handover. **Cut:** local discriminated request state/reducer; keep data in cache. Delete the independent failure/flight pair and derive loading/error from one current request. S; do not move all cache/seed policy into a new framework.

## 9. Sheet presentation, exit cache and custom navigation — defer, M

**Files/ranges:** `blocks/popup/PopupHost.tsx:473-666,747-813`; `app/shared/stores/runtime/popupStore.ts:54-150`.

**Representation:** store `current/isOpen/openSeq/destroyed`; host `wasOpenRef/openCycle/lastPayload/mountedSeq/presentAttempt/presented/lastOpenRef`; custom stack, direction, footer, keyboard and footer measurement. **States/events:** unmounted → presenting → open → closing → unmounted; replace, revive closing snap-point sheet, native close, watchdog retry/give-up, custom push/pop.

**Illegal/reachable:** payload B with A's custom stack/footer for a render; presented with no mounted instance is type-legal. **Traced:** replacing custom payload changes `current` before effect 655-666 resets the old stack, while `activeCustomPage` at 647-650 still prefers the old stack. This is a render-level mismatch, not proof of a user-visible wrong action on device. Close retains payload/mount for 400 ms deliberately; openSeq need not equal mountedSeq when a closing native instance is reused. Those are meaningful states, not defects. Scoped close and timer cleanup prevent several stale-close paths.

**Persisted:** session-only popupStore and local state. **Consumers:** one host consumes these detailed phases; store-facing popup producers need no API change. **Pins:** `popupHostPresentation.test.tsx`, `popupStorePresentationNonce.test.ts`, `actionMenuHandoff.test.tsx`; custom stack/footer replacement, native reuse and keyboard interactions need pins first.

**Cut:** eventually a presentation reducer with request identity, instance identity, exit payload and retry count, and a separate keyed custom-navigation state. Delete independent presentation setters and reset effects, preserving instance-reuse policy. **Defer** until native iOS and Android evidence is available: the existing asymmetries address real native overlay failures and an abstract machine without those checks can regress them. M, 2–5 files.

## 10. Restore-gate decision — leave saved model; optional local conversion, S

**Files/ranges:** `blocks/AppGate.tsx:224-319`; `app/shared/stores/global/walletLifecycleStore.ts:9-52,55-89`.

**Representation:** hydration, local `evaluated`, saved `restoreStatus/seedCreatedAt`; async keychain evaluation with cancelled flag. **States/events:** hydrating → deciding → recovery-required/open; hydration, keychain resolution, old-status healing, confirmed recovery.

**Illegal/reachable:** representation permits evaluated plus unresolved status and inconsistent marker/status pairs. **Traced and intentional:** unknown + no mnemonic ends evaluated while status remains unknown; children open for new-wallet setup. Failed/in-progress + existing seed marker becomes not-needed, intentionally healing historical stranded values. Fresh mount waits for hydration/evaluation; cleanup rejects stale keychain completion. No new definite illegal production path was established. Do not turn historical compatibility states into parse errors.

**Persisted:** global key `wallet-lifecycle`, fields `restoreStatus`, `seedCreatedAt`, `lastRestoreAt`, `lastRestoreError`. Keep all six accepted status values. A pure read-boundary decision union can preserve these bytes and the historical resolution policy.

**Consumers:** one gate; SettingsRecoveryScreen receives only gateMode/onComplete. **Pins:** `restoreGateDecision.test.tsx`, `walletLifecycleTransitions.test.ts`, `settingsRecoveryGateConfirmation.test.tsx`. Ledger notes the hydration test reaches an earlier AppGate wait; isolate RestoreGate hydration before any rewrite. **Recommendation:** leave the saved model; optional S pure decision projection removes repeated status comparisons, but ranks below reachable defects. No async framework needed.

## 11. Picker sheet route — leave, S

**Files/ranges:** `lib/picker/sheetRoute.ts:29-157`.

**Representation:** explicit `route: none/opening/open/leaving`, instance, timer, current/shown/waiting opener collections, answered bit. **States/events:** already named; Open replaces current or queues while leaving, Mounted opens, Answer leaves, Unmounted ends, opening watchdog ends stalled push.

**Illegal/reachable:** type permits none+current or open+no current, but public functions synchronize these: show claims current before opening; end settles and clears; answer requires current+open; unmounted checks instance; timer checks opening+instance. No reachable meaningless combination traced under the normal router contract. `shown` is not a duplicate of current: replaced openers still need their closed promises resolved.

**Persisted:** none. **Consumers:** picker and emoji entrypoints (`lib/picker/openPicker.ts`, `lib/picker/openEmojiPicker.ts`) plus `lib/picker/useSheetRouteScreen.ts`: three direct adapters. **Pins:** `openPicker.test.ts`, `pickerSheet.test.tsx`, `emojiPickerSheet.test.tsx`, `pickerSheetCallers.test.tsx`; a future conversion would first pin synchronous router push failure and delayed native mount after watchdog. **Leave:** already an explicit small machine. A cosmetic union would delete few guards and obscure the separate result/closed promise contracts.

## Defects

New findings (follow-ups searched before listing; no follow-up files written):

- **D1 — wrong payment confirmed / wrong View target (run).** `hooks/usePaymentStatusListener.ts:728-738,858-870`: active payment-request/melt A, unrelated send/melt B finalizes, A is confirmed or receives B's operation ID. Failing regression idea: emit B and require A's owner/state/View target to remain unchanged. Existing QUIRK assertions currently expect the defect. Repair runtime correlation only; no stored data or wire-format change.
- **D2 — acceleration polling resurrects after cleanup (traced).** `hooks/useMempoolAcceleration.ts:125-127,140-170`: defer invoice, unmount or switch txid, resolve invoice; old continuation creates a new interval and can stop the new txid's poll. Pending status results also acknowledge after cleanup. Failing regression idea: after unmount-before-invoice-resolution, resolve invoice and advance 15 seconds; expect no status call or annotation write. Repair runtime ownership; same persisted annotation schema and wire requests, fewer stale writes.
- **D3 — cancelled theme still applies (traced).** `theme/lib/themeDraft.ts:190-213,236`; `theme/screens/ThemePreviewScreen.tsx:119-128`: defer primary download, Apply, Cancel, resolve download; saved theme changes after discard and the completion clears any later draft. Failing regression idea: saved theme and a newly opened draft remain unchanged after the cancelled commit resolves. Repair changes when existing theme fields are written, not their schema or wire format.

Existing defects: **F178** (recovery timeout ownership and forced-gate dead ends), **F177** (refused deletion treated as complete), **F187** (unaccepted swap toast latches mounted; production early-call reachability still unknown), **F189** (failed wallpaper download still saved). Their candidate entries above identify current source and pins; these are references, not duplicate follow-ups. Pass-0 hard-coded send/melt units and nested-error log redaction are recorded repaired in the ledger; the current listener uses operation.unit.

## Not read

- Excluded `app/shared/lib/cashu/**` and `app/shared/lib/persist/**` implementations. No sibling checkout, mint protocol implementation, network, full test suite, device or simulator was used. This survey does not decide mint protocol behavior.
- Shared library directories not covered by the specific traces above (notably profile/session orchestration, backup, migrations, logger internals, cache implementation, Nostr helpers, HTTP, map and instrumentation). The wider assignment contains more than the pass-0 shared survey; these remain unsurveyed, not declared clean.
- Most `app/shared/ui/**`, `app/shared/blocks/**` and hooks beyond the named candidates. NativeSplashLayoutGate was read through its initial anchor-settle path, not through all animation/timer completion paths; it already names SplashPhase, so no whole-file verdict is asserted. The outer AppGate cascade was not re-audited.
- Settings design-system/demo files and most settings screens. SettingsKeyringScreen loading/import/generate paths and SettingsProfileRecoveryScreen's generation/background clearing were sampled, not fully surveyed; no complete candidate or safety claim for those flows. Theme Gallery/Background were inventoried as draft consumers; their layout/gesture logic was not audited.
- Other producers/consumers outside the assigned paths were located or read narrowly for boundary contracts; whole payment engines, Coco stored proofs/counters, wallpaper download implementation, native toast library and cache stores were not audited. Test bodies were inspected selectively (especially the executed payment quirks and acceleration unmount test), not every named test in full.
