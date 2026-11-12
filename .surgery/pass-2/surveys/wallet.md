# Wallet package: pass 2 survey (implicit state machines)

Checkout `sovran-surgery`, branch `surgery/pass-2` at `26ef519bc` (pass 0 fixes `29b6e02a0`, `f88ab8518`, `176b4f4be`
are ancestors). Read-only: no product file written, no git writes, no network, no `jg`. Runtime evidence came from four
`bun --eval` programs run in `wallet/` against the real `createPaymentMachine`, `createDefaultScreenActionHandlers`
and `getAvailableActions` with the test fixtures (`__tests__/_harness/fixtures.ts`) and in-memory fake operations; no
file was written and no test suite was run. "Run" below means one of those programs showed it; "traced" means read.

Started from `.surgery/pass-0/surveys/wallet.md` (its target list rows 1–10). Known defects F180 (standing-quote work
outliving a profile switch, concurrent rotations) and F181 (receive/mint lookup adopting another row) are cited, not
repeated. F135 lists unbuilt machine behaviours; nothing here repeats it.

## What `wallet/src/machine` already uses (the house pattern)

A hand-written machine, no XState or other library. Conversions elsewhere should match these pieces:

| Piece | Where | Shape |
| --- | --- | --- |
| State names | `machine/types.ts:18-43` | `FlowStep`, a string-literal union of 25 steps |
| Per-state data | `machine/types.ts:156-340` | `StepDataMap[S]`, written only through `setStep<S>(step, data)` (`createMachine.ts:288-294`), so step and data move together |
| Long-lived context | `machine/types.ts:379-498` | `FlowContext`, one record of ~30 optional fields (the weak spot, see C6) |
| Events | `machine/types.ts:563-660` | `FlowEvent`, a discriminated union on `type` |
| Transition | `machine/transitions.ts:700-842`, `resolveNext.ts`, `contextResolution.ts`, `flows/{send,receive}.ts` | Pure `transition(step, ctx, event, …) → {step, context, data}`; global events first, then per-step events |
| Effects | `machine/effects.ts` | Each async step is a `run*Effect` returning neverthrow `ResultAsync<{kind:'completed'\|'stale'\|'rolledBack'\|…}, {kind:'failed', cause}>`; effects return links and notifications as data, the machine applies them |
| Cancellation | `createMachine.ts:280,307-316` | A flow generation counter; every effect gets `isStale(op)` and a stale result is dropped (success and failure alike) |
| Re-entrancy | `createMachine.ts:268-280,789-809` | `sendLocked` (a turn is running), `commitGeneration` (money is moving), `INTENT_EVENTS` (`:209`) that may supersede a resolve but never a commit |
| Output | `createMachine.ts:61-181,323-330` | `ExecutionState` derived from step + data, cached for `useSyncExternalStore` |
| Docs | `wallet/docs/STATE_MACHINE.md` | Steps, events, lifecycle, generations, per-flow expectations |

Phase logic that sits outside that structure, inside the machine file: the turn bookkeeping (C4), the NFC tap (C5), the
send-fallback retry box (`sendFallback`, `:517`), the per-call confirm holders (`:285`), the scan dedupe and source
(`:255-256`), and the "paid" sub-phase of the two preview steps (C2). Outside the machine: the screen-action entry
`metadata.phase` strings (C1), the resource hooks (C7), the history state vocabulary (C8), the wallet context tracker
(C9) and the transactions loader (C10).

Other packages already explicit, listed so a conversion copies them rather than inventing: `rebalance/engine.ts:62-74`
(`ChainResult`, `HopResult`, `Settlement` unions), `legacy-ecash/records.ts:45-100` (persisted `z.enum` statuses with
`.default().catch()`), `transport/redeemOrchestrator.ts:5-6` (`MeshRedeemStatus` union), `history/timeline/flows.ts`
(table of steps with `done`/`when` predicates), `ReceiveExecuteResult` (`machine/types.ts:79-96`).

## Candidates, ranked

Rank = reachable illegal states × money or saved-data risk, over cost.

### C1. Payment-request send outcome: a broad confirm result and stringly entry phase — **convert** (defect D1)

1. **Where.** `machine/createMachine.ts:285` (`pendingPaymentRequestConfirms`), `:1029-1037` (snapshot/`settle`),
   `:1075-1113` (`settle(true)` / `settle(false)` on success and on failure alike), `:2272-2287`
   (`confirmPaymentRequest(): Promise<{rolledBack: boolean}>`); `screen-actions/defaultHandlers.ts:549-621`
   (`paymentRequest.confirm`); `screen-actions/availability.ts:402-425` and `:1175-1190` (`isPaymentRequestPreview`);
   `operations/defaultOperations.ts:499-530` (`buildRolledBackResult`) and `:2059-2078` (delivered enrichment);
   `app/features/send/screens/PaymentRequestScreen.tsx:71-86`, `TimelineCard.tsx` (read `tokenCreated`/`nostrSent`).
2. **Variables.** The confirm result `{rolledBack}`; on the screen entry: `state` (`"pending"`/`"rolledBack"`),
   `operationId` (top level and in metadata), `metadata.phase` (`"preview"`/`"delivered"`/`"rolledBack"`/absent),
   `metadata.tokenCreated: "true"`, `metadata.nostrSent: "true"`, `metadata.transportType`.
3. **States.** preview → delivering → delivered | rolledBack | failed (no token) | failed (token created, rollback
   failed) | ignored (locked out / stale). Events: confirm tap, `executePaymentRequest` resolve/throw, rollback.
4. **Meaningless combinations.** `{rolledBack:false}` stands for delivered, failed, ignored and stale at once.
   `phase:"delivered"` with no token created; `operationId` equal to a preview id (`pr-preview-…`); `tokenCreated`
   and `nostrSent` as the strings `"true"` beside a `phase` that already says it; `phase:"rolledBack"` reads as
   "delivered" in availability (`isDelivered = phase === "delivered" || hasOperationId`, `:410`).
5. **Reachable today — run.** Machine at `navigateToPaymentRequest` from `INPUTS.paymentRequestBasic`;
   `executePaymentRequest` throws `"This payment request does not accept that mint"` (an `AuthoredError` the default
   operation throws before any token exists, `defaultOperations.ts:1886-1897`). `confirmPaymentRequest()` returns
   `{"rolledBack":false}`; the default `paymentRequest.confirm` handler then writes
   `{state:"pending", metadata:{phase:"delivered", operationId:"pr-preview-1", tokenCreated:"true", nostrSent:"true"}}`
   and availability turns `confirm` and `cancel` off. The app has no override for this handler (grep), so the payment
   request screen says sent, the timeline shows "token created, sent", and the person cannot retry; only the failure
   toast from `onPaymentFailed` says otherwise. See D1.
6. **Persisted?** No. The entry lives in the screen-action session (route seed + in-memory updates); the history row
   is Coco's. The enriched `historyEntry` JSON goes to navigation and `onTransactionCreated`, which records
   `rawInput`/`source`, not `phase`.
7. **Consumers.** `defaultHandlers.ts` (writer), `availability.ts` (2 readers), `effects.ts`, `history/timeline/*`
   (4 files read `tokenCreated`/`nostrSent`), app `PaymentRequestScreen.tsx`, `TimelineCard.tsx`, design-system
   timeline scenarios.
8. **Pins today.** `wallet/__tests__/flows/payment-request.test.ts`, `screen-actions/defaultHandlers.test.ts`,
   `screen-actions/pending-actions.test.ts`, `integration/operation-outcome-contract.test.ts`, app
   `paymentStatusListener.test.tsx`. Pin first: the confirm handler's entry after success, after rollback, after a
   throw before token creation, and after a locked-out second tap.
9. **Recommendation.** Convert. `confirmPaymentRequest()` returns a union
   `{kind:'delivered', historyEntry} | {kind:'rolledBack', message} | {kind:'failed', message} | {kind:'ignored'}`
   built from the effect result the machine already has; the handler switches on it. Decode the entry's phase once
   into a union at the availability boundary, keeping the string fields on the wire for the timeline.
10. **Deletes.** The holder list and its snapshot/drain dance (`createMachine.ts:285,1029-1037,2276-2286`), the
    duplicated preview test (`availability.ts:406-410` vs `:1181-1183`), two hand-built entry literals in
    `defaultHandlers.ts`. Size S–M (machine, handlers, availability, one app screen).

### C2. "Paid" is an optional field on the two preview steps — **convert** (defect D2)

1. **Where.** `machine/types.ts:266-291` (`navigateToMeltPreview.historyEntry?`, `navigateToPaymentRequest.historyEntry?`);
   `effects.ts:654-660` (success keeps the step); `createMachine.ts:885-1012` (CONFIRM_MELT guard checks only the
   step and `operations.executeMelt`), `:1020-1124` (same for payment requests); `docs/STATE_MACHINE.md` §5.2
   ("step STAYS"); `operations/defaultOperations.ts:1528-1533` (pre-created quote consumed on first use).
2. **Variables.** `step`, `stepData.historyEntry`, `stepData.meltQuote`, the consumed `precreatedMeltQuotes` map.
3. **States.** preview(unpaid) → paying → paid | failed-stay. Paid is not a state; it is `historyEntry !== undefined`.
4. **Meaningless.** A paid preview that accepts CONFIRM_MELT; a paid preview whose `meltQuote` points at a quote the
   operations map no longer holds.
5. **Reachable — run (machine), not traced end to end (UI).** `enterAmount(100 sat, MINT1, {destination:"meltQuote",
   meltTarget:"alice@example.com"})`, `confirmMelt()` succeeds, `confirmMelt()` again: `executeMelt` called twice
   (`melts 2`), step stays `navigateToMeltPreview`. With the default `executeMelt`, the second call finds no
   pre-created quote and, for a Lightning address, fetches a fresh invoice (`:1587-1596`), which is a second real
   payment. The only guard is the screen: `meltQuote.pay` is available while `entry.state === "UNPAID"`
   (`availability.ts:396`), and the entry turns `PAID` only when a bridge update matches (`createManager.ts:663-693`).
   Not traced whether a window exists between `confirmMelt` resolving (action loading cleared) and that update.
   The payment-request step has the same shape (traced, not run); its screen guard is C1's phase, which also
   switches confirm off after a failure.
6. **Persisted?** No.
7. **Consumers.** The two CONFIRM_* branches, `meltQuotePreview.ts`, app `sovranPaymentConfig.ts:1140,1172`
   (handlers), `LightningSendScreen.tsx` (reads entry state).
8. **Pins.** `flows/quote-first-melt.test.ts`, `flows/lightning-melt.test.ts`, `flows/confirm-dead-end.test.ts`,
   `flows/payment-request.test.ts`, `property/machine-invariants.test.ts`. Pin first: "a second confirm after a
   successful melt / delivery does not call the operation again" (fails today), and that a failed one still retries.
10. **Recommendation / deletes.** Convert: either a terminal step (`meltPaid`, `paymentRequestDelivered`) or a
    required `phase: 'preview' | 'settled'` in those two step datas, checked in both guards. A new step needs app
    handlers; the data tag does not. Deletes nothing yet; it closes a double-spend path. Size S.

### C3. "Stay on this step" is encoded as `data: {}` — **convert** (defect D3)

1. **Where.** `machine/transitions.ts:792` (MINT_TRUSTED without token), `:825` (stray PROOFS_CHOSEN), `:834` (stray
   SEND_MEMO_SUBMITTED), `:841` (any unhandled event, including CONFIRM_MELT / CONFIRM_PAYMENT_REQUEST off their
   step), all `{step: currentStep, context, data: {} as any}`; `createMachine.ts:1285` (`setStep(result.step,
   result.data)` unconditionally), `:1974-1980` (error notification by `errorData.code`), `:1990`
   (`dispatchHandler(step, stepData)`).
2. **Variables.** `step` unchanged, `stepData` replaced by `{}`.
3. **States.** "no transition" should leave step and data alone and dispatch nothing.
4. **Meaningless.** Every step with its data replaced by `{}` while the step name says the data is there; an `error`
   step with no `code` or `message` (both typed as required).
5. **Reachable — run.** (a) `startReceive({reset:true})` then `chooseProofs(5)`: step stays `receiveHub`, the
   `receiveHub` handler is called again with `{}`. (b) A Lightning-address melt fails with an npub.cash fallback
   offered, the person dismisses it (`chooseSendFallback(null)`, step `error` with `MELT_FAILED`), then taps Pay on
   the still-mounted preview: `inspect()` becomes `{status:"blocked", code:"UNSUPPORTED_INPUT"}` with no message,
   the `error` handler is dispatched with `{}`, and `executeMelt` is not called. The tap is dropped silently, which
   `createMachine.ts:866-873` (BTC-09) says must not happen. Whether Pay is still enabled after that dismissal
   depends on the preview entry staying `UNPAID` (traced: a pre-quote LNURL failure leaves no quote, so it does).
6. **Persisted?** No.
7. **Consumers.** Every step handler in app `sovranPaymentConfig.ts:951-1495`; `deriveExecutionState`; three app
   screens that read `inspect()` (`AmountFlowScreen`, `ReceiveScreen`, `MintSelectFlowScreen`).
8. **Pins.** `unit/transitions.test.ts:535-556,927-931` assert only the step. Pin first: step data and handler calls
   unchanged after each stray event.
9. **Recommendation.** Convert: `transition` returns `{kind:'unchanged'}` (or `null`) and the machine skips
   `setStep`, notification and dispatch. Matches the effects' `{kind:'stale'}` convention.
10. **Deletes.** Four `data: {} as any` casts and the re-dispatch. Size S.

### C4. The turn around a step: lock, commit, generation, executing, holders — **convert** (after C1–C3)

1. **Where.** `createMachine.ts:252-305` (state and `resetInternal`), `:307-316`, `:789-809` (lock and supersede),
   22 `isStaleGeneration(sendGeneration, …)` checks between `:905` and `:2015` and 10 `kind === "stale"` early
   returns between `:760` and `:1953`, 26 `handlerExecuting =` writes, `:517-523` (`sendFallback`), `:2187-2219`.
2. **Variables.** `sendLocked`, `commitGeneration`, `flowGeneration`, `handlerExecuting`,
   `pendingPaymentRequestConfirms`, `sendFallback`, `processedScanInput`, `lastScanSource`, `urDecoder`.
3. **States.** idle; resolving(gen) (an effect that may be superseded); committing(gen) (money moving, everything
   dropped); dispatching(gen) (handler running, lock held). Events: `send(event)`, effect settle, `reset()`,
   supersede by an INTENT event.
4. **Meaningless.** `handlerExecuting` true while `sendLocked` false; `commitGeneration` set with `sendLocked` false
   (deliberate after `reset()`, `:275-279`); `sendFallback` set while the step is not `chooseSendFallback` (it is not
   cleared by `resetInternal`); `lastScanSource` left as `"nfc"` after an ignored or cancelled scan.
5. **Reachable — traced.** `sendFallback` surviving a reset is harmless (only `lockFallbackFor`/`npcFallbackFor` move
   to that step and both overwrite it). `lastScanSource` leaking into a later `execute()` would turn a pasted
   payment request into an auto-executing NFC send (`:1171,1394-1696`); every app entry point goes through `scan()`,
   which overwrites it, or passes `reset:true` (`NoteContent.tsx:287`), so the app cannot reach it today; the public
   `execute()` contract can. A `reset()` during a commit drops the late success's `linkTransaction` and
   `onTransactionCreated` (`:951-967`) by design ("stale-success suppression", pass 0); whether that loses an
   annotation the person would miss is an owner question, not a defect claimed here.
6. **Persisted?** No.
7. **Consumers.** All inside `createMachine.ts`; `inspect().isExecuting` read by three app screens.
8. **Pins.** `flows/interruptions.test.ts`, `flows/back-nav-reentry.test.ts`, `flows/execute-routing.test.ts`,
   `unit/machine-effects.test.ts`, `unit/nfc-machine.test.ts`, `property/machine-invariants.test.ts`; app
   `paymentRouteReentry.test.tsx`, `cameraScanBoundary.test.tsx`. Pin first: supersede during a resolve keeps the
   lock with the new turn; commit drops every event; reset during commit lets the next flow start and the old
   `finally` does not unlock it; the scan source is consumed by exactly one EXECUTE.
9. **Recommendation.** Convert to one `turn` union (`idle | resolving{gen} | committing{gen}`) plus a single
   `finishTurn(gen)` that clears executing and the lock only when `gen` still owns it. Keep generations (the house
   cancellation). Fold `sendFallback` into the `chooseSendFallback` step's private data and `lastScanSource` into
   the EXECUTE event (`scan()` already knows it).
10. **Deletes.** Most of the 26 `handlerExecuting` writes, four "unlock if not stale" `finally` blocks and the safety net,
    `sendFallback`, `lastScanSource`, the holder list (with C1). Size M (one file, large).

### C5. The NFC tap: session, unit switch and mint verdicts as locals of one `send()` call — **convert**

1. **Where.** `createMachine.ts:1149-1236` (unit switch, `revertNfcUnit`, `nfcSwitchedUnit`, `readContext`),
   `:1385-1696` (`nfcResolved`, `nfcAlternative`, `nfcRefusedMints`, `nfcPayableMints`); `effects.ts:1709-1820`
   (write-back releases the session); app `runTapToPayScan.ts`, `useAmbientNfcArm.ts`.
2. **Variables.** Whether the tag session is held, whether the host unit was switched and must be restored, the
   refused and payable mint sets, the invoice alternative.
3. **States.** reading → (unit switched) → choosing option → choosing mint → writing → done(released, unit kept on
   success, restored on failure). Every exit should release the session and, on failure or abandonment, restore the
   unit (comment at `:1152-1153`).
4. **Meaningless.** Loop exits that release without restoring, or do neither: "No viable option" (`:1451-1454`),
   "No candidates at all" (`:1576-1577`) neither releases nor restores; `enterAmount` (`:1578-1585`) releases but does
   not restore; the generic else (`:1690-1694`) does both.
5. **Reachable — not established.** After a switch the request was found funded in the new unit (`:1196-1203`), so
   an empty candidate list or all-disabled options needs a mint the payability gate or row rules disable; not traced
   to a concrete tag. Recorded as a shape risk, not a defect.
6. **Persisted?** The unit switch writes the app's active unit (a persisted setting) through `operations.switchUnit`;
   an exit that skips the restore leaves the person in the terminal's unit.
7. **Consumers.** Only `send()`; app NFC hooks own the other half of the session.
8. **Pins.** `unit/nfc-machine.test.ts` (20 cases), app `nfcSessionBoundary.test.ts`, `useAmbientNfcArm.test.tsx`.
   Pin first: for each loop exit, session released once and unit restored or kept as stated.
9. **Recommendation.** Convert to a small tap object with one `finish(outcome)` that releases and restores exactly
   once; the loop becomes a transition table over the four steps it auto-resolves.
10. **Deletes.** Four scattered release/revert pairs. Size S–M.

### C6. Lock state in `FlowContext`: a mirrored pubkey and an optional "is optional" flag — **convert** (pass 3 sized)

1. **Where.** `machine/types.ts:411-439`; `transitions.ts:393-394,404-457,480-517,744-758`; `p2pk/lock.ts:117`
   (`isLockedSend` reads either field); `createMachine.ts:526-557` (`lockFallbackFor`), `:364,382`;
   `contextResolution.ts:56,899,919`; `amountFallback.ts:169-223`; `effects.ts:876-918,1007-1027,2079`;
   `flows/send.ts:44-181`; `screen-actions/availability.ts:450`; `defaultHandlers.ts:855`;
   `defaultOperations.ts:703-705`.
2. **Variables.** `p2pkLock`, `p2pkLockPubkey` (documented as a mirror: "write BOTH"), `lockIsOptional`,
   `paymentRequestLockPubkey`.
3. **States.** none | optional(spec) (added on the amount screen) | required(spec) (arrived with the flow).
4. **Meaningless.** `p2pkLockPubkey` without `p2pkLock` (START_SEND_ECASH accepts the bare key, `:756-758`);
   the two disagreeing; `lockIsOptional` true with no lock; a required lock cleared by `p2pkLock: null`
   (`resolveLockPatch` clears whatever is there, `:486-489`, and `lockIsOptional` keeps `undefined`).
5. **Reachable — partly traced.** The bare-key start is live (Nut Drop callers). Clearing a required lock needs the
   amount screen to send `null` for a seeded lock; the app's `useSendLock`/`seededLockKey` appear to handle seeded
   locks, not traced.
6. **Persisted?** No (flow context). The lock terms reach the saved annotation through `sendComplete.p2pkLock`.
7. **Consumers.** 12 files above.
8. **Pins.** `flows/ecash-send-p2pk.test.ts`, `flows/send-fallback.test.ts`, `unit/p2pk-lock.test.ts`,
   `unit/transitions.test.ts`; app `useSendLock` and `sendLockReclaimGate` tests.
9. **Recommendation.** Convert to `lock: {kind:'none'} | {kind:'optional', spec} | {kind:'required', spec}` with the
   pubkey derived; `null` from the screen can only clear `optional`.
10. **Deletes.** The mirror field and its "write both" rule, `lockIsOptional`, the either-field read in
    `isLockedSend`. Size M.

### C7. Resource hooks: value, loading, error and generation side by side — **convert**

1. **Where.** `react/useReusableMintQuote.ts:104-228` (rotate `:211-225`); `react/useStandingPaymentRequest.ts:92-278`
   (rotate `:243-268`, `freshDoneForRef` `:103`).
2. **Variables.** `quote`/`request`, `isLoading`, `error`, `generation`, `mountedRef`, the per-effect `cancelled`,
   `quoteIdRef`/`operationIdRef`, `freshDoneForRef`.
3. **States.** empty (no input) | loading | ready(value) | revalidating(value) | failed(error) | ready(value) with a
   failed rotation. Events: input change, quote event, identity-store change, `refresh`, `rotate`, unmount.
4. **Meaningless.** `error` set beside a fresh value: `rotate` success never clears an earlier `error`; a `rotate`
   that resolves after the input changed sets the old mint's quote or request (`rotate` checks only `mountedRef`,
   not the input it started with).
5. **Reachable — traced.** Error-beside-value is masked by both consumers (`ReceiveReusableQuoteTab.tsx` shows the
   error only when there is no request). The late rotate: tap "new address" on mint A, switch the tab's mint to B
   before it resolves; B's effect sets B's quote, then A's rotate sets A's quote under B. Needs a mint switch inside
   one `quotes.mint.create` round-trip.
6. **Persisted?** The hooks write nothing; the helpers they call write `mintStore.standingQuotes` (F180).
7. **Consumers.** `ReceiveUnifiedTab.tsx`, `ReceiveReusableQuoteTab.tsx`, `ReceiveScreen.tsx`,
   `useNearbyDiscovery.ts`.
8. **Pins.** App `walletReusableMintQuoteHook.test.tsx`, `walletStandingPaymentRequestHook.test.tsx` (pass 0).
   Pin first: rotate success clears an earlier error; a rotate finishing after an input change is discarded.
9. **Recommendation.** Convert both to one reducer `{status:'idle'|'loading'|'ready'|'failed', value, error, key}`
   shared by the two hooks; results carry the key they were started for and are dropped when it no longer matches.
10. **Deletes.** One of two near-identical hook bodies (~120 lines), `mountedRef` (replaced by key checks). Size S.

### C8. History state vocabulary compared as strings across 15 files — **convert** (L, pass 3 candidate)

1. **Where.** `history/states.ts:21-75` (the declared one owner, but `normalizeContractState` returns `string` and
   passes unknown values through); stringly comparisons: `history/filters.ts` (21, e.g. `:45-93,190-210`),
   `screen-actions/availability.ts` (12, `:246-397`), `history/timeline/flows.ts` (12), `legacy-ecash/claim.ts` (7),
   `operations/defaultOperations.ts` (6, `mapMeltOperationState` `:126-130` duplicates `MELT_OP_STATE_TO_LEGACY`),
   `timeline/classify.ts` (5), `rebalance/engine.ts` (4), `history/refresh.ts`, `receiveOperations.ts` and others.
2. **Variables.** `entry.state` (two vocabularies: `UNPAID/PAID/ISSUED/PENDING` and
   `prepared/pending/executing/finalized/rolled_back/rolledBack/failed`), `remoteState`, lower-cased copies.
3. **States.** Per flow (mint, melt, send, receive), four to six states.
4. **Meaningless.** Any string; every predicate accepts both vocabularies (`isMintQuotePaymentObserved` checks six
   spellings); `isPendingTransaction` lower-cases and compares `"unpaid"` while others compare `"UNPAID"`; a mint
   `failed` maps to `UNPAID` (documented compromise, `states.ts:43-47`).
5. **Reachable.** Not traced to a wrong screen in this pass; pass 0 found two real bugs from the same spread (cited
   in `states.ts:13-17`).
6. **Persisted?** Not by this package (Coco owns the rows). The strings cross route params and the app as JSON, a
   wire contract to keep: decode at the read boundary, keep the JSON.
7. **Consumers.** 15 wallet files, app transactions screens and timeline.
8. **Pins.** `unit/states.test.ts`, `history-filters`, `history-normalize`, `timeline*` (brute force),
   `screen-actions/availability.test.ts`.
9. **Recommendation.** Convert in pass 3: typed per-flow unions out of `normalizeHistoryEntry`, predicates as
   exhaustive switches.
10. **Deletes.** `mapMeltOperationState`, the dual-spelling arms in ~40 comparisons. Size L.

### C9. Wallet context tracker: "not loaded yet" looks like "empty wallet" — **defer**

1. **Where.** `core/walletContextTracker.ts:88-107,168-173,184-325,363-376`.
2. **Variables.** `trustedMints = []`, `balancesByMintAndUnit = {}`, `revision = 0`, `refreshing`, `pendingRefresh`,
   `consecutiveFailures`, `disposed`.
3. **States.** loading (first refresh) | ready(revision) | ready-but-stale (last refresh failed) | backed off (failure
   budget spent, `:298-306`) | disposed.
4. **Meaningless.** Before the first refresh `getContext()` returns no trusted mints and zero balances, the same
   value as a wallet with nothing in it; after failures it serves the last snapshot with no signal.
5. **Reachable — not traced.** A deep link or scan handled before the first refresh would route on an empty context
   (no trusted mint → review or NO_VALID_MINT). Not followed through the app's startup gate.
6. **Persisted?** No.
7. **Consumers.** The machine (`ColadaProvider.tsx:390-391`), `useScreenActions.ts:489-500`, amount manager.
8. **Pins.** `unit/core-factory.test.ts`, `integration/wallet-context.test.ts`.
9. **Recommendation.** Defer: exposing `status` changes what screens show at startup; owner decision.
10. **Deletes.** Nothing until consumers read the status. Size M.

### C10. Transactions loader: mode, offset sentinel and coalescing flags — **leave the loader, delete page mode**

1. **Where.** `react/useColadaTransactions.ts:248-406`.
2. **Variables.** `mode ('infinite'|'page')`, `offset` (starts at `-pageSize`, a sentinel), `hasMore`, `isFetching`,
   `refreshPending`, `supplementRead`.
3. **States.** loading-first-page | idle | fetching(+refresh queued). The coalescing is already one flag pair.
4. **Meaningless.** `mode:'page'` followed by `loadMore` appends page N+1 to page N's window, and a refresh then
   prepends page 0, leaving a gap.
5. **Reachable.** No: `goToPage` has no caller in `app/` or `wallet/src` (grep). Only the infinite path runs.
6. **Persisted?** No.
7. **Consumers.** `useHistoryWithMelts.ts` → `TransactionsScreen.tsx`.
8. **Pins.** `unit/shared-wallet-read-models.test.ts`, app `walletReadModels.test.ts`.
9. **Recommendation.** Leave the loader; delete `goToPage` and `mode` in pass 3 (knip may not see it because it is
   part of the returned object).
10. **Deletes.** `goToPage`, `mode`, the window branch of `refresh` (~30 lines). Size S.

### C11. `ExecutionState.code` is a narrower vocabulary than `ErrorCode` — **convert** (small)

1. **Where.** `createMachine.ts:140-169`; `machine/types.ts:356-373` (17 codes) vs `:528-545` (14 blocked codes).
2. **Variables.** `stepData.code` and the derived `ExecutionState.code`.
4. **Meaningless.** `NO_AMOUNT`, `MISSING_MELT_TARGET`, `INVALID_P2PK_LOCK` and a missing code all report
   `UNSUPPORTED_INPUT`; `message` typed `string` can be `undefined` (C3).
5. **Reachable — run** (C3 path b shows the collapse with no message); an invalid lock reports "unsupported input"
   to any screen reading `inspect()` (traced).
6. **Persisted?** No. 7. **Consumers.** Three app screens via `inspect()`/`useExecutionState`.
8. **Pins.** `property/machine-invariants.test.ts`, `flows/*` assert codes. 9. **Recommendation.** Convert:
   `ExecutionState.code` becomes `ErrorCode` for blocked. 10. **Deletes.** The 14-way `||` chain. Size S.

### C12. Standing quote and standing request lifecycle — **defer to F180**

`quotes/reusable.ts:69-124` (per-manager `inFlight`, `resolvedCache`, identity store) and
`payment-request-receive.ts:265-330` (same shape). Pass 0 fixed the cross-manager sharing (`f88ab8518`, `176b4f4be`).
What remains (dispose cancels nothing, writes after a profile switch, concurrent rotations both create) is F180 and
writes `mintStore.standingQuotes`, so it waits for that decision. One addition for the owner: a failed lookup of
the recorded quote (`createReason = "lookup_failed"`, `reusable.ts:198-210`) creates and records a new one, so a
transient database error rotates a bolt12 offer the product treats as permanent (`:136-138`). Traced; documented as
deliberate in the code, so not filed as a defect here.

### C13. Receive and mint-quote result attribution — **defer to F181**

`operations/receiveOperations.ts:90-110,500-530`: the exact-first lookup landed in pass 0 (`29b6e02a0`); the
remaining new-row fallback is F181 (needs a decision).

### Left as they are (already explicit)

- `transport/redeemOrchestrator.ts:5-6,118-224`: persisted `MeshRedeemStatus` union with a single-flight drain and a
  manager-identity check after each await. The app port owns the transitions. Leave.
- `legacy-ecash/claim.ts`, `records.ts:45-100`: a durable machine with persisted `z.enum` statuses, a `claiming`
  journal and tolerant reads; heavily pinned in pass 0. Leave; it is saved data.
- `rebalance/engine.ts`: results are unions already; in-flight receipts per lock (`:62-74`). Leave.
- `react/unitPins.ts`: `unitRef.current` is derived from a pin stack but written only beside it. Leave.
- `react/sharedReadStore.ts`, `useColadaBalance.ts:139-160`: generation-guarded single-flight. Leave.
- `screen-actions/session.ts:210-460`: `parseError` beside the previous entry after a bad reseed; consumers check
  `error` first. Leave.
- `amount-actions/createManager.ts:142-600`: two input modes; `clampedToCap` survives `toggle` (`:570-600`) but the
  converted value is the cap. Leave.

### Unused parallel state model (delete in pass 3)

`machine/flows/send.ts:15-30,232-254` and `flows/receive.ts:158` define `SendFlowState`/`ReceiveFlowState` unions with
`actions` and `copyKeys`, exported as `sendFlow`/`receiveFlow`. Only `unit/send-flow.test.ts` and
`unit/receive-flow.test.ts` read them; the machine uses only `startSendEcashFlow`/`startSendFlow`. A second state
vocabulary nobody runs. In instance mode (the app's), `usePaymentFlowMachine`'s `setWalletContext`
(`ColadaProvider.tsx:1076-1087`) is also unread by the machine (`:390-391` uses the tracker); `useScreenActions.ts:500`
still reads it for proof amounts, so the two can disagree. Pass 3.

## Defects

None of these is in `docs/follow-ups/` (grepped for the symbols and for "delivered", "twice", "step data").

**D1. A failed payment-request send is shown as delivered.** `screen-actions/defaultHandlers.ts:594-620` with
`createMachine.ts:1113` (`settle(false)` on failure) and `:2276`. Path: scan a payment request, Pay; the default
operation throws before creating a token (mint not accepted, amount mismatch, unsupported lock, unit mismatch,
`sendNostrDM` missing) or delivery fails and rollback also fails. The handler receives `{rolledBack:false}` and writes
`phase:"delivered"`, `state:"pending"`, `tokenCreated:"true"`, `nostrSent:"true"`, `operationId` = the preview id;
confirm and cancel become unavailable. **Run** (in-memory, real handler and availability). Test idea:
`paymentRequest.confirm` with `executePaymentRequest` throwing leaves `metadata.phase === "preview"` and `confirm`
available. Repair touches no stored data and no wire format (screen entry only).

**D2. A second Pay after a successful melt pays again.** `createMachine.ts:885-889` (guard ignores
`stepData.historyEntry`), `effects.ts:654-660`, `defaultOperations.ts:1528-1533,1587-1596`. Path: Lightning-address
melt, Pay succeeds, Pay again while the screen still offers it: `executeMelt` runs a second time; with no pre-created
quote left it fetches a new invoice from the address. **Run** at the machine (`melts 2`); the screen guard
(`availability.ts:396`, entry state) was not traced end to end, so whether a person can reach it is open. Same
guard shape for `navigateToPaymentRequest` (`:1020-1022`), traced only. Test idea: `confirmMelt()` twice after a
success calls `executeMelt` once. No stored data or wire format.

**D3. An event the current step does not handle wipes its data and re-runs its handler.** `transitions.ts:792,825,
834,841` with `createMachine.ts:1285,1990`. Path: dismiss the npub.cash fallback after a failed Lightning-address
payment, then tap Pay: step `error` loses `code` and `message`, `inspect()` says `UNSUPPORTED_INPUT` with no
message, the tap does nothing (contradicts BTC-09, `:866-873`). Also `chooseProofs` on `receiveHub` re-dispatches the
receive hub with `{}`. **Run.** Test idea: after any stray event, `getStep()` data and handler call count are
unchanged. No stored data or wire format.

**D4 (minor). The synthetic payment-request entry is always in sats.** `operations/defaultOperations.ts:2124-2138`
(`buildSyntheticPaymentRequestEntry` hard-codes `unit: "sat"`) used at `:2051-2056` when the canonical history row
is not found; the same at `:1401-1408` for receive. A USD payment request whose row lookup misses shows its cents as
sats. **Traced**; the canonical lookup by id (`:104-124`) almost always finds the row, so rarely reached. Test idea:
`executePaymentRequest` in `usd` with `getHistoryEntryById` → null returns an entry with `unit:"usd"`. No stored
data; the JSON entry is a wire contract to the app, the fix only corrects a value.

## Not read

- `machine/resolveNext.ts`, `contextResolution.ts`, `amountFallback.ts` beyond the lock and flag sites grepped;
  `effects.ts` beyond the confirm, melt-preview and payment-request effects and the result-type outline.
- `operations/defaultOperations.ts` send, offline send, onchain and receive bodies beyond the sites cited; the
  rescue paths (`:139-260`) were not re-read (pass 0 covered them).
- `screen-actions/availability.ts` beyond the melt, mint and payment-request rules; `defaultHandlers.ts` beyond the
  melt and payment-request handlers; `useScreenActions.ts` beyond the session wiring and amount config.
- `history/timeline/*` (flows table read only for state comparisons), `history/aggregate`, `annotations/*`,
  `copy/*`, `formatting/*`, `chain/*`, `lnurl`, `nip05`, `parse`, `detectors`, `offline`, `mint-capabilities`,
  `mint-selection`, `wallet-seed`, `subscriptions/*` (only the shapes).
- `rebalance/engine.ts` past line 200, `legacy-ecash/claim.ts` past line 260, `useColadaBalance.ts`,
  `useColadaTransactionAnnotation.ts`.
- App screens were read only where a wallet state reaches them; no app test, simulator or device was run. No test
  file was run; the four `bun --eval` programs are the only runtime evidence.
