# Transactions, wallet and mints: implicit state machines

Checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery`, HEAD `26ef519bc5d5c77fa574b6e23a535b1cff5a807b`.
Product code was read only. Paths below are repository-relative; abbreviated `mint/`, `wallet-ui/` and `transactions/` mean `app/features/mint/`, `app/features/wallet/` and `app/features/transactions/`. Test names without a directory are in `app/__tests__/`.

Started from the pass 0 candidates and checked `.surgery/LEDGER.md` against current sources and tests. **Traced** means followed the code; **run** means observed in the one test file executed this survey. Command: `cd app && bun run test -- debouncedMintValidation.test.ts --runInBand`: **1 suite, 14 tests passed**. Other test coverage below was read, not rerun. No native/device, funded, full-suite or network verification was performed. An initial `jg` call before reading the brief returned incomplete with a provider error; no findings depend on it, and subsequent discovery used local searches only.

Ranked by reachable inconsistent states and money/saved-data impact relative to conversion cost. “Permits” alone is not evidence that a state is reached. Counts refer to direct production consumer files, excluding re-exports, generated manifests and tests. Proposed conversions preserve saved and wire shapes; they are not implemented here.

## 1. Rebalance run ownership and terminal reporting — convert, M

**Files/ranges:** `mint/hooks/useMintRebalanceOrchestrator.ts:39-81,97-151,186-442`; `mint/screens/MintRebalancePlanScreen.tsx:178-205,483-551`; `app/shared/stores/runtime/swapStatusStore.ts:22-51`; `app/shared/stores/runtime/legProgress.ts:32-187`; `app/shared/stores/profile/swapTransactionsStore.ts:219-250`; engine boundary `wallet/src/rebalance/engine.ts:1031-1140`.

**Encoding:** `runStatus`, `runPlan`, `isRunningRef`, `abortRef`, `runIdRef`, manager identity, group id, step-id/leg-id map, plus toast `active.state` and saved group `state`. Plan/state React values and refs are separate copies.

**States/events:** preview → running on Start; running → cancelled on Cancel; running → finished with success/failure/unsettled outcome on engine report; terminal → retrying on Retry/Retry failed; route preparation → running after intermediaries are trusted. Manager replacement invalidates the old run; unmount intentionally leaves it running.

**Illegal combinations/reachability:** **traced:** Start → fail → Cancel → single-step Retry → done gives screen `finished`, saved group `cancelled`, and a terminal cancelled toast with a done leg. `handleRetry` never finalizes/restarts those other projections. This sequence is characterized in `mintRebalanceRunLifecycle.test.ts`, not rerun here. Also **traced:** replace manager during verification → engine returns aborted → `report` clears `isRunningRef` then returns before changing `runStatus` or toast/group. Existing test checks no late settlement, not terminal cleanup. An exception escaping `runSteps` likewise fails the toast but leaves screen `running`; normal transfer errors are usually caught by the engine, so arbitrary RPC failure is not evidence for this latter path.

**Persistence:** runtime run state is not saved; `swap-transactions-store.groups[id].state` is profile-scoped and saved. Keep that shape; derive a richer run view and explicitly project terminal events onto it.

**Consumers:** one direct hook consumer, plan screen. Additional projections are consumed by swap row/detail, toast and payment listener; their coordination is the boundary, not extra independent run owners.

**Pins/first additions:** `mintRebalanceRunLifecycle.test.ts`, `mintRebalanceOrchestrator.test.ts`; pin manager-invalidated terminal cleanup, cancel during manual-route trust setup, retry against a second screen's active run, and single retry's group/toast consistency using real stores (current lifecycle tests fake them).

**Conversion/deletion:** one run reducer with generation/manager ownership and explicit terminal outcome; retain the engine's lock. Reuse the transition/effect separation already present in `wallet/src/machine/{types,transitions,effects}.ts`, without moving screen state into the payment machine. Delete duplicate running/abort flags, scattered start/reset/finalize sequences and independent terminal decisions. M, roughly 5–8 files. Held/stranded retry behavior is already **F139**; resolve that policy before changing retry semantics.

## 2. Saved swap recovery confuses a live run with an interrupted one — convert, M

**Files/ranges:** `app/shared/stores/profile/swapTransactionsStore.ts:23-78,140-208,219-359`; `app/shared/lib/cashu/reconcileSwapLegs.ts:23-118`; `app/shared/hooks/useSwapLegReconciler.ts:11-29`; `transactions/components/SwapTransactionRow.tsx:24-41`; `transactions/screens/SwapTransactionScreen.tsx:225-366,550-562`; sink `mint/lib/rebalanceStepSink.ts:94-169`.

**Encoding:** saved group `state`, leg `localStatus`, optional quote/operation ids, operation states from Coco, and existence of an in-memory runner. The latter is absent from the saved shape. `quoteIdToGroup` is a second, saved index beside the leg quote ids.

**States/events:** active run; interrupted/recovering; outgoing unknown; paid/awaiting issue; arrived; rolled back. Start/leg events write ids and phases; startup and mint/melt operation events trigger reconciliation.

**Illegal/reachable:** **traced:** terminate the process after a leg becomes `melting` or `verifying`, before group finalization. Hydration restores `group.state='running'`; the runner and toast are gone. Reconciliation selects these legacy phases only if the group is *not* running (`:48`), so even finalized owned operations never advance this leg. Even a saved `settling` leg that reconciles to done leaves its group running. The row therefore remains Pending. Missing ids on settling records are also representable, but not proven reachable from the current sink's normal event order. Atomic quote tagging/patching already prevents the ordinary missing-group index write; do not claim every parallel index diverges.

**Persistence:** profile key `swap-transactions-store`, fields `groups`, `quoteIdToGroup`. Decode unchanged records into active/interrupted states using live ownership and operation evidence; never tighten old leg fields or rename saved statuses.

**Consumers:** four direct downstream files: reconciler, transaction list, swap row, swap detail; hook/sink orchestrate writes. Row/detail currently make separate completion decisions.

**Pins/first additions:** `reconcileSwapLegs.test.ts`, `swapTransactionsStoreLegPatch.test.ts`, `swapTransactionsStorePersistResilience.test.ts`, `swapTransactionTotals.test.tsx`, `transactionsSwapTimeline.test.tsx`. Pin hydration of running+melting, running+done, missing operation ids, manager disposal during awaited reads, and disagreement between row/detail. Reconciler's compare-before-write guard is worth retaining.

**Conversion/deletion:** read-boundary recovery union and shared aggregate selector/transition table. Delete repeated raw-status interpretation and group-state-as-runner-existence assumption; keep raw storage as compatibility data. M, 6–8 files. Existing unfinished-chain/detail discrepancy is **F139**, timeline scoping/hiding is **F205**, not new defects here.

## 3. Rebalance step and routing payload bag — convert, M

**Files/ranges:** `mint/components/rebalance/groupSteps.ts:16-29,46-84`; `mint/components/rebalance/RebalanceStepRow.tsx:37-89,99-250`; `mint/components/rebalance/RebalanceChainCard.tsx:27-160`; `mint/lib/rebalanceRunState.ts:26-151`; `mint/lib/rebalanceStepSink.ts:32-89,119-185`; `mint/hooks/useMintRebalanceOrchestrator.ts:134-151,323-398`; `mint/screens/MintRebalancePlanScreen.tsx:483-551`.

**Encoding:** status plus optional invoice, operation id, error, routing detail and suggestion with independently optional path/pathNames. Parallel `plan.steps`, step-state record and step-to-saved-leg map encode one run's legs.

**States/events:** pending → creatingInvoice → invoiceReady → melting → paymentPending / verifying → settling / done / failed; route search → found/none → routing → inserted hops; Skip and Retry alter the same record.

**Illegal/reachable:** found suggestion without a path, invoiceReady without invoice, pending with a previous operation id/error, done with a live route suggestion. **Traced:** retry reset spreads the old state and clears only error/suggestion; invoice/operation id remain while status returns to pending. `routingToStepState(null)` clears only routingDetail, leaving the last candidate suggestion on subsequent updates. A retained invoice may be useful history, so separate historical attempt data from current-phase requirements rather than indiscriminately deleting it. Status-only Skip also retains payloads. Missing step state is handled with defaults; no normal event path was found that executes a nonexistent plan step.

**Persistence:** StepState itself is runtime. Sink maps a subset onto saved `swap-transactions-store.groups[].legs[].localStatus/errorMessage/*OperationId`; decode/project without changing that schema.

**Consumers:** five state-reading files: orchestrator, run-state helpers, groupSteps, chain card, plan screen; RebalanceStepRow consumes the unpacked flags. Sink writes them.

**Pins/first additions:** `mintRebalanceRunState.test.ts`, `mintRebalanceOrchestrator.test.ts`, lifecycle test. Pin retry after an invoice exists, route candidate→done, skip versus superseded-original distinction and synchronous ref visibility after inserting hops.

**Conversion/deletion:** discriminated step union with distinct attempt evidence, route suggestion union and reducer events; delete `Partial<StepState>` merges, nullable-path guards and parallel status-specific clearing. Reuse engine's existing discriminated routing events. M, 7–9 files; no need for a new machine library.

## 4. Debounced URL validation is not bound to its input — convert, S

**Files/ranges:** `mint/hooks/useDebouncedMintValidation.ts:9-141`; `mint/screens/MintAddScreen.tsx:302-315,397-430`.

**Encoding:** url, `{isValid,isLoading,error}`, mintInfo, debounce timer and abort controller. Validity has no validated-url identity.

**States/events:** empty → debouncing on edit → checking on timer → valid(info) / invalid(reason) on answer; Edit, Clear, Reset and Unmount cancel/supersede work.

**Illegal/reachable:** **run:** valid A → edit B retains `isValid=true` and A's info during B's debounce/fetch; an invalid-format new input returns before aborting the old request, whose answer can become the current valid result. **Traced:** MintAdd builds B's selectable pseudo-row with A's info because it checks validity/info, not ownership/loading. Already **F186/F207**, not a new defect entry.

**Persistence/consumers:** none saved; one consumer file, MintAddScreen (status indicator and pseudo-row are two interpretations).

**Pins/first additions:** `debouncedMintValidation.test.ts` ran, 14 passed including both quirks. Pin old answer landing *inside* the next debounce window and a rendered pseudo-row being selectable only for its validated URL before changing behavior.

**Conversion/deletion:** local tagged union `empty | debouncing(input, generation) | checking(input, generation) | valid(input, info) | invalid(input, reason)` and one cancellation owner. Delete three independently set result fields, validity/info cross-checks and format-before-abort ordering. S for hook representation; M if screen behavior pin is included.

## 5. Trusted-mint read lifetime and manager ownership — convert, M

**Files/ranges:** `mint/hooks/useMintManagement.ts:17-77,113-196`; `app/shared/lib/cashu/recoverySuppression.ts` (deferred refresh integration). Direct consumers: `app/shared/hooks/useMintInfo.ts`, `app/features/contacts/screens/ContactsScreen.tsx`, `app/features/settings/screens/SettingsRecoveryScreen.tsx`, `mint/screens/{MintAddScreen,MintDistributionScreen,MintRebalancePlanScreen}.tsx`, `wallet-ui/components/MintSelector/useMintSelector.ts`.

**Encoding:** global unkeyed inflightLoad, manager-keyed lastLoad, each mount's mints/isLoading and recovery deferral.

**States/events:** cold/loading; warm/revalidating; ready; failed with stale/empty data; account reset awaiting outstanding work. Mount, mint event, manual load, recovery flush and reset move between them.

**Illegal/reachable:** **traced**, characterized by `mintManagementCache.test.ts`: new-manager hook mounting before old read resolves joins it, then caches old mints under the new manager. Already **F207**; whether normal account reset always prevents that ordering remains unconfirmed. Load errors also leave empty+not-loading indistinguishable from an actual empty wallet. Reset waits for the current read; that helps, but does not bind every late callback to an owner.

**Persistence/consumers:** read state is memory-only, manager mints are Coco data (unchanged). Seven direct consumer files listed above. Global mint metadata caching is a separate read boundary.

**Pins/first additions:** `mintManagementCache.test.ts` pins dedupe, warm reads, event refresh, failed-read retention and reset. Pin *real account-switch ordering* and an event arriving while a snapshot read is outstanding (does a follow-up refresh occur?).

**Conversion/deletion:** manager-owned read state with request generation and queued invalidation, preferably reuse Coco's mint subscription where its contract matches. Delete unowned module globals and per-mount replicated loading/list state. M, under ten files. Avoid changing mint trust decisions or storage.

## 6. Keyset-unit reads have cancellation but no ordering — convert, S

**Files/ranges:** `wallet-ui/hooks/useMintKeysetUnits.ts:20-83`; read interpretation `wallet-ui/hooks/useActiveUnit.ts:85-133`; other direct consumers `app/shared/providers/WalletContextProvider.tsx`, `mint/screens/MintDistributionScreen.tsx:109-125`, `mint/screens/MintRebalancePlanScreen.tsx:98-122`.

**Encoding:** unitsByMint with absent/undefined=unknown and []=known-empty, effect-local cancelled flag, concurrent load promises. One cancellation token covers *all* reloads in an effect.

**States/events:** unknown → loading → known units / failed-unknown; mint event/recovery flush → refresh; dependency replacement → cancelled old generation.

**Illegal/reachable:** **traced:** initial load L1 pending → mint:updated starts L2 in the same effect → L2 publishes new keysets → L1 publishes old units last. Both see cancelled=false. Unknown due to failure versus not-yet-read is intentionally collapsed; that alone is not a defect. Cleanup prevents the old effect's eventual publications, but does not order reads within an effect. Active-unit availability may change back after the stale answer.

**Persistence/consumers:** local result not saved; four direct callers (active unit, wallet context, distribution, plan). Coco keyset DB remains unchanged. `mint-store.activeUnit` is read, not rewritten by resolveActiveUnit.

**Pins/first additions:** `resolveActiveUnit.test.ts` pins the fallback function only; no direct hook ordering test found. Pin two deferred keyset loads completing in reverse order, and profile replacement with the same mint URL before conversion.

**Conversion/deletion:** request generation or serialized read with dirty/reload event, carrying unknown/known result per mint. Delete effect-wide cancellation as the sole freshness proof and repeated unknown interpretation. S implementation; consumer type changes would make it M.

## 7. Operator social read can lose its replacement and remain loading — convert, M

**Files/ranges:** `mint/hooks/useMintProfiles.ts:30-65`; `mint/hooks/useMintDetailRead.ts:47-54,133-176,183-225`; `mint/screens/MintInfoScreen.tsx:317-356`; `mint/screens/MintAddScreen.tsx:451-456`; `app/shared/stores/global/mintMetadataStore.ts:59-64,296-315`.

**Encoding:** inflight Set by mint URL, per-effect controller, persisted social timestamp/data; detail social status inferred from pubkey and stale cache. Audit/reviews separately use fetching/failed/settled triples and a failedRef.

**States/events:** absent → fetching → ready/empty/error; input replacement aborts; Retry/refocus should restart failed work. Audit/reviews already assign complete triples atomically and ignore aborted completion, so impossible fetching+failed triples are **not** reached by those setters.

**Illegal/reachable:** **traced:** render with input array A → profile read begins/adds key → input array B contains the same mint (another discovery row changes) → cleanup aborts A → new effect sees key still in Set and skips it → A completion removes key without any React state update. No subsequent read is scheduled. Detail's cold social state remains loading because operator exists and cache is stale. Independent path: failed social fetch also has no failure state; Retry increments attempt for audit/reviews but does not change stable profileInputs, so it cannot retry social. This is not the well-controlled audit/reviews triple problem.

**Persistence/consumers:** social payload/stamps are in global `mint-metadata-store.byMintUrl` (per URL); request state/GroupState not saved. Two useMintProfiles callers (MintAdd, detail hook); one direct detail consumer (MintInfo). Keep saved payload and decode read state around it.

**Pins/first additions:** `useMintDetailRead.test.ts` mocks useMintProfiles, so it does not pin these paths. Add a real social-hook deferred-abort/same-key rerender test and failed-social Retry test. Keep existing stale-data-ready and audit/review retry pins.

**Conversion/deletion:** key-owned read lifecycle using the existing query-cache read pattern (`useMintSearch` already uses it), with explicit failed/empty result and refresh input. Delete inflight Set/controller ownership split and stale-implies-loading inference. M, 3–5 files. Leave the audit/reviews internals unless unifying them actually deletes duplicated transitions.

## 8. Distribution's even/custom mode drifts from saved weights — convert, M

**Files/ranges:** `mint/screens/MintDistributionScreen.tsx:92-103,136-164,190-239,320-343`; `app/shared/stores/profile/mintDistributionStore.ts:174-180,283-361,406-465`.

**Encoding:** selectedCurrency, supported mintUrls, splitEvenly, seededSplitEvenlyFor, and saved distributions. The seed effect runs once per currency, not per membership generation.

**States/events:** unseeded → even/custom after initialization; toggle even equalizes; toggle custom keeps current values; manual slider writes custom weights; mint membership/keyset changes initialize the distribution.

**Illegal/reachable:** **traced:** begin with three equal enabled mints and mode ON → one mint ceases supporting the unit → initializeDistribution removes it and normalizes the two survivors; mode remains ON. With starting weights 3334/3333/3333, removing a 3333-weight mint leaves 5001/4999, while the screen claims even and locks sliders. `seededSplitEvenlyFor` prevents recomputing mode for that same currency. Adding a new mint at zero does not by itself violate evenness among enabled mints, so is not cited as a defect.

**Persistence/consumers:** `mint-distribution-store.distributions[unit][url]` saved profile weights; mode/ref only local. One owner screen reads mode; MintBalanceDistribution receives slidersDisabled. Keep weights unchanged in format; a conversion can decode `even/custom` from them and apply explicit membership transitions.

**Pins/first additions:** `mintDistributionStorePersistResilience.test.ts` protects saved-shape tolerance; `mintDistributionSelectors.test.ts` is selector/source evidence, not this interaction. Pin uneven remainder followed by removing a supported mint, enabled-only evenness and switching currencies before conversion.

**Conversion/deletion:** reducer for currency/mode/membership events with weights projected through existing store actions; delete seed ref and initialization/seed ordering dependency. M, 2–3 files. Repair changes saved weight values, not fields or wire format.

## 9. Ambient NFC arming, sheet and scan lifetime — defer, M

**Files/ranges:** `wallet-ui/hooks/useAmbientNfcArm.ts:46-172`; `app/shared/stores/runtime/nfcTapStore.ts:20-43`; `app/features/send/lib/runTapToPayScan.ts:35-69`; `app/features/send/lib/sovranPaymentConfig.ts:469-474,800-809`; `app/shared/lib/popup/popups/nfcTapSheet.tsx:43-121`; wallet integration `wallet-ui/screens/WalletScreen.tsx:130-150`.

**Encoding:** active, userDismissedSheet, armed, phase, ambient-cycle module flag, popup ownership, latest machine, native session and outstanding rearm timeout.

**States/events:** inactive → capability check → disabled-wait / popup-paused / scanning; tag → reading/payment phases; scan end → rearm-wait; dismissal suppresses reopening; blur/background releases session. Android-only; iOS returns immediately.

**Illegal/reachable:** armed=true while no scan is running is **traced** during the 600ms rearm delay and popup pauses after an earlier cycle. This may mean “available” rather than “native session armed”; do not silently alter it. A previous scan's finally can clear ambient-cycle after a new focus loop starts if native release resolves late; possible ordering, not run. Continued scan during swap is pinned and already **F207**. Existing active recheck after isNfcEnabled prevents starting a scan after blur during that await.

**Persistence/consumers:** none. Direct phase readers outside owner/store are tap-sheet and runTapToPayScan; payment config writes phases, wallet owns loop. Native/session functions were read only at call boundaries.

**Pins/first additions:** `useAmbientNfcArm.test.tsx` covers arming, popup pause, dismiss, blur/background, swap behavior and latest machine. Add blur→refocus before old scan promise settles, and capability-probe rejection. No native behavior observed.

**Recommendation/deletion:** defer until session owner and payment survey agree on late-release ownership; then a small async machine with owned session/generation and cancellable delays, following existing wallet machine conventions. Delete polling-loop booleans and scattered teardown. M, fewer than ten files. Product confirmation policy is explicitly documented, not an inferred bug.

## 10. Pending reclaim and visual collapse are parallel collections — convert, M

**Files/ranges:** `transactions/screens/TransactionsScreen.tsx:125-184,274-295`; `app/shared/stores/runtime/rollbackStore.ts:22-85`; `transactions/components/Transaction.tsx:206-207` and collapse rendering; `transactions/components/Transactions.tsx:310-315,558-565`; RPC boundary `app/shared/lib/cashu/utils.ts:82-107`.

**Encoding:** visiblePendingEcash snapshot, isSweeping, inFlight Set, collapsing Set and per-success timer. One entry's phase spans two sets.

**States/events:** idle → reclaiming on Start → collapsing on success → idle after hold timer; failure → idle. Sweep serially starts these transitions for a captured list.

**Illegal/reachable:** both Sets can contain one id: **traced at action boundary**, succeed(id) → start(id) before hold expires. Row reads two true flags. One-row handler guards inFlight; sweep bypasses that guard, so invoking a row cancellation then the footer sweep can issue a second reclaim for its snapshot entry. Whether Coco rejects/serializes the second operation and whether the UI permits that exact tap timing was not run; no double-spend claim. Unlike a naive missing-finally finding, normal RPC rejection does **not** strand isSweeping: attemptRollback catches and returns false.

**Persistence/consumers:** runtime only (Coco's payment operation records unchanged). Three consumer files: screen, Transaction, Transactions.

**Pins/first additions:** `cashuRollbackBoundary.test.ts` pins state-aware cancel/reclaim and false on error, not sweep concurrency. Add row+sweep overlap, repeated success timers, and account switch mid-sweep with real rollback store.

**Conversion/deletion:** per-operation `idle | reclaiming | collapsing(deadline)` transition table plus sweep snapshot/progress state. Delete dual Sets, separate membership guards and stale success timers. M, 4–5 files; serialize through one owner rather than adding guards in each caller.

## 11. History pagination queue — leave, S

**Files/ranges:** `transactions/screens/TransactionsScreen.tsx:186-216`; `transactions/hooks/useHistoryWithMelts.ts` (pass-through history source).

**Encoding:** isFetching, hasMore and pendingLoadMoreRef; history length is diagnostic, not a saved total.

**States/events:** ready → fetching on end reached; end reached during fetch → fetching-with-demand; settle → next load if hasMore, otherwise exhausted. Fetch ownership is in the underlying history hook; this screen stores only one bit of demand.

**Illegal/reachable:** queued demand with hasMore=false is representable, but effect clears it before exiting, so it is benign. No traced stranded queue in the current implementation; the explicit drain addresses the virtualizer's single end-reached event. Repeated callbacks before React reflects isFetching could call loadMore twice, but requires checking the underlying Coco guard before calling it a defect.

**Persistence/consumers:** none; one owning screen reads the queue. Transactions emits onEndReached; it does not own the demand flag.

**Pins/first additions:** pass-0 survey explicitly noted this gap; `transactionsSwapTimeline.test.tsx` exercises list composition, not this screen queue. Pin end-reached during initial fetch, exhaustion while queued and rapid repeated end-reached if modifying it.

**Recommendation/deletion:** leave: the bit encodes an actual independent demand, not duplicated fetch phase. A union here would duplicate the upstream hook's machine. No deletion justified; S if a future hook exposes queue-aware loadMore.

## 12. Mint batch import already names its item states — leave, S

**Files/ranges:** `mint/hooks/useMintImport.ts:6-107`; `mint/screens/MintAddScreen.tsx:311` and import-state rendering/handlers.

**Encoding:** nullable state, running, named per-item stage, inFlight and mounted refs. Stages are waiting/adding/restoring/complete/restore-failed/failed, not a bag of optional errors/results.

**States/events:** absent → batch running on Start; waiting → adding → restoring → complete; add failure → failed; restore failure/profile replacement after add → restore-failed; batch completion → report; Dismiss → absent.

**Illegal/reachable:** running=false with waiting/adding items is representable, but finally converts those items to failed before publishing false. No such reachable terminal combination found. Double Start is prevented synchronously by inFlight, Dismiss is disabled by the same ref, and manager identity is checked before each add/restore. Profile replacement during an initiated restore does not cancel that operation; the next item is blocked. The ref/state duplication serves synchronous event exclusion and mounted rendering rather than two independent business phases.

**Persistence/consumers:** hook state not saved; added/trusted mints and restored funds belong to Coco and remain saved even on restore failure. One consumer, MintAddScreen. Conversion can preserve all Coco data formats.

**Pins/first additions:** `mintImport.test.tsx` covers duplicate taps, normalized dedupe, partial success, replacement and unmount. If refactoring, first pin manager unavailable and replacement during restore, preserving already-added mints.

**Recommendation/deletion:** leave; already explicit stages, ordered transitions, bounded responsibility. A reducer could replace running with an outer batch discriminant but would delete little beyond a boolean and should not outrank the reachable defects above. S.

## Defects

These are behavior defects rather than mere representable states. All new items are **traced, not run**. Repair suggestions preserve saved shapes; only the named survey is written, so no new follow-up files were created.

1. **Interrupted swaps remain running after restart.** `app/shared/lib/cashu/reconcileSwapLegs.ts:48-50`, `app/shared/stores/profile/swapTransactionsStore.ts:227,350-358`, `transactions/components/SwapTransactionRow.tsx:33-37`. Kill a running swap at melting/verifying; rehydrate; finalize both owned Coco operations; reconciler never selects the leg and never closes the saved group. Failing test: hydrate running+melting, supply finalized melt/mint, run reconciler, require a recovered terminal view instead of perpetual Pending. Repair concerns saved status *values*/read interpretation, no schema or wire change. Distinct from F139's held onward hop.
2. **Keyset read can roll back a newer capability result.** `wallet-ui/hooks/useMintKeysetUnits.ts:29-42,70-73`. Same effect: L1 reads old rows, mint update starts L2, L2 publishes then L1 resolves and overwrites it; supported units can disappear or unsupported ones reappear. Failing test: two deferred reads complete newest-first, assert newest result survives. Runtime only; no saved/wire shape change.
3. **Social read replacement can leave a permanent spinner; Retry cannot recover a failed social read.** `mint/hooks/useMintProfiles.ts:41-47,59-65`, `mint/hooks/useMintDetailRead.ts:207-218`. Cleanup aborts old same-key work, replacement skips the inflight key, completion removes it without rerender/retry; separately failed fetch leaves social inferred loading. Failing test: rerender with a new array containing the same mint before aborted promise settles, then assert a replacement request completes; also assert Retry restarts a failed social read. No stored-shape/wire change; successful reads still stamp the existing metadata fields.
4. **Single-step retry leaves cancelled history/toast after success.** `mint/hooks/useMintRebalanceOrchestrator.ts:319-345,414-428`. Failed step → Cancel → Retry → done updates screen/leg only; group/toast remain cancelled. Failing test: extend lifecycle retry pin with real stores, require their terminal projections to agree after success. Changes existing saved status values, no field or wire change. The current characterization test explicitly records this quirk; it does not assert consistency.
5. **“Split evenly” can stay on while saved survivor weights differ.** `mint/screens/MintDistributionScreen.tsx:158-164`, `app/shared/stores/profile/mintDistributionStore.ts:301-332`. Seed ON for 3334/3333/3333; remove one 3333 mint from supported membership; normalization yields 5001/4999, screen stays ON with disabled sliders. Failing test: membership change while even mode is on must retain even weights or turn off the claim. Repair writes saved weight values through existing actions; no format change.

Existing findings are referenced rather than restated: **F173** non-sat rebalance unit/proof selection; **F139** held/stranded routing and completion mismatch; **F186** mint-pill unit, validation and mock profile balance issues; **F205** swap timeline hiding/scoping; **F207** manager-unkeyed mint read, validation and ambient swap overlap. The old failed-leg fee defect in F186/pass 0 is already repaired for a leg with neither history side; current totals tests and the ledger record that repair. Do not refile it from the old survey.

Pass-0 candidates not promoted: filter context's multiple independent filter choices are mostly orthogonal dimensions, not a phase machine; repeated filter definitions and duplicated grouping/totals algorithms are pass-3 module-boundary candidates. Mock balance adapters are not phase machines; their known profile write is F186. Audit/review GroupState triples have constrained atomic setters; social lifecycle, rather than the number of booleans alone, is the actionable candidate above.

## Not read

- Full wallet engine internals, route scoring/graph algorithms, mint fee/proof selection and vendor implementations; only engine call/result/cancellation boundaries needed above were traced. No network or adjacent-checkout comparison was attempted under the survey brief.
- Native NFC implementation/session scheduling; payment-machine execution internals, NFC receipt/write-back, and whether native callbacks can arrive after session release. NFC overlap is conditional evidence, not a reproduced native defect.
- End-to-end account-switch/reset ordering, profile storage implementation and underlying Coco history loadMore guards. No claim that F207's manager overlap occurs on every ordinary switch.
- Most transaction detail presentation, AI conversation screens, row animation bodies, charts, expiry, zaps and location sections; history month scrolling/reveal timers were sampled, not exhaustively audited.
- Full mint list/info/reviews/changes screens, trust/accept flows, search-cache internals, discovery liveness/presence, distribution slider components and all store numerical algorithms. Distribution initialization/normalization and even-mode control were read; arbitrary weighting correctness was not certified.
- Settings/profile/mock stores beyond the known pass-0 caller descriptions. No persisted-state migration/release certification was performed.
- Test bodies were selectively read for the named boundaries. Only debouncedMintValidation.test.ts was executed; no other tests, lint, typecheck, saved checks, bundles, simulator or emulator checks ran.
