# Wallet package: sweep 1 survey

Area: `wallet/src`, `wallet/docs`, `wallet/README.md`. Branch `surgery/sweep-1` at `4c80d9f5c`. Nothing was changed.

How it was read: `machine/createMachine.ts`, `machine/effects.ts`, `machine/transitions.ts`,
`operations/defaultOperations.ts`, `operations/receiveOperations.ts` and `transport/redeemOrchestrator.ts` end to
end; the rest by search (see "Not read"). `bun run knip` at the root printed nothing (clean). Every dependency in
`wallet/package.json` is imported by `src` or `__tests__`. `wallet/src` has no lint or type suppression. Each
finding was searched for in `docs/follow-ups/` and `.surgery/`; where one is adjacent, its id is cited.

"Run" means a script outside the repo drove the real machine; everything else is traced from the source.

## 1. Broken

**B1. A mint list that finished loading for an earlier picker replaces the rows of the picker now open. Run. fix**
`machine/createMachine.ts:926-967` (`startMintListEnrichment`), stale check at `:321`. `flowGeneration` moves only
on a reset or a superseding event (`:360`, `:394`), not per turn, so a later turn has the same generation and the
old result is not stale; the only other guard is `step === "selectMint"`.
Path: open the npub.cash mint picker (`requestMintSelector({scope:"npc"})`), pick a mint before the list has
loaded, then start an ecash send with no preferred mint (second `selectMint`). When the first load answers after
the second, `inspect().details.mintListItems` holds the npub.cash picker's rows with status `ready`, under a send
picker (other verdicts, other disabled reasons). Output of the run: `after B: ready B-for-send`, then
`after stale A: ready A-for-npc scope undefined`.
Test: two deferred `buildMintListItems`; resolve the second, then the first; expect the second's rows to stay.
Repair: each enrichment remembers the step data it was started for and applies only while the open list descends
from it (a counter is enough). Nothing saved or sent. Commit: "Drop a mint list that loaded for an earlier picker".

**B2. A Nostr payment request whose send fails to execute leaves its ecash reserved. fix**
`operations/defaultOperations.ts:1945-1959`: `ops.send.prepare` then a bare `mgr.ops.send.execute(prepared.id)`.
`executeSend` (`:773`), `executeOfflineSend` (`:831`) and `executeNfcSend` (`:1249`) all go through
`executeSendWithRescue` (`:211`, "Safety-critical: keep ONE copy"), which cancels the prepared operation when
execute throws; the fourth caller does not, and the throw happens before the delivery `try` that rolls back
(`:1984`). Path: Pay on a creq with only a Nostr transport, mint drops during the swap: the preview shows the
failure and the proofs stay reserved, with a pending row, until a recovery run.
Test: `ops.send.execute` rejects in `executePaymentRequest` (Nostr request); expect `ops.send.cancel` with the
prepared id and the original error. Nothing saved or sent changes. Commit: "Release the reservation when a
payment request's send fails to execute".

**B3. Pay again after a failed Lightning payment charges a quote the person never saw. list**
`defaultOperations.ts:1557-1562` deletes the pre-created quote as `executeMelt` starts. A failure on a
single-option flow keeps the step and its `meltQuote` (`createMachine.ts:876-877`, phase stays `preview`), so the
second Pay sends the same `quoteId`, finds nothing, and creates a new quote (`:1636-1644`); for a Lightning address
it also asks for a new invoice (`:1616-1625`). The screen still shows the first quote's fee, and
`onPaymentProcessing` names the first quote's id (`createMachine.ts:1229`), which the payment toast is keyed by.
The expiry path next to it (`createMachine.ts:1177-1211`) does the opposite: shows the new quote and asks for a
second tap. Test: fail `executeMelt` once, Pay again; expect either a refreshed preview or the same quote, not a
silent third quote. Sends a different quote to the mint; nothing saved. Owner decides: re-quote and ask again, or
keep the quote for the retry.

**B4. An NFC tap whose token was made but whose history row is not there yet reports "write failed" and takes
nothing back. list**
`defaultOperations.ts:1257-1268` throws after `executeSendWithRescue` returned a token. In
`machine/effects.ts:1730-1790` the throw arrives with `nfcSendResult` still null, so the stage is `prepare`, no
`rollbackSend` runs and `tokenOutstanding` is false: a pending send stays in the wallet and the error says nothing
about it. `executeSend` and `executeOfflineSend` build an entry from the operation in the same case (`:801-808`).
Whether Coco's projected history can still miss right after execute was not checked (the send paths still log
`historyMissing` as possible). Test: `getHistoryEntryById` returns null in `executeNfcSend`; expect a token and a
built entry. Nothing saved or sent. Owner decides only if the miss is real; then the repair is the send path's.

**B5. An animated QR that ends in a decode error blocks every later animated QR until the camera is reopened. fix**
`createMachine.ts:2279-2292`: the decoder is replaced only after `isComplete() && isSuccess()`. One that is
complete and failed stays, keeps ignoring parts, and every `ur:` scan returns `urInProgress: true`. The only way
out is a reset (the camera resets on focus, `CameraScreen.tsx:131-139`). A second, different sequence scanned
after an abandoned one stalls the same way; that half needs a rule for "a different sequence began" and is
**list**. Test: decoder fake with `isComplete: true, isSuccess: false`; the next `ur:` part starts a fresh decoder.
Nothing saved or sent. Commit: "Start a new decoder after an animated QR fails to decode".

**B6. A request that offers both Nostr and HTTP is paid over HTTP and recorded as sent over Nostr. list**
`defaultOperations.ts:1872` takes the Nostr branch only when there is no HTTP transport, but the delivered entry is
stamped from `nostrTransport` alone (`:2113-2115`: `nostrSent: "true"`, `transportType: "nostr"`), as is the log
line (`:2120`). The preview label says "Nostr" for the same request (`screen-actions/createManager.ts:821-827`).
Three places, two answers. Test: creq with `post` and `nostr` transports; expect `transportType: "http"` and no
`nostrSent`. The entry's metadata reaches annotations (saved). F44 holds the transport choice itself; this is the
record and the label disagreeing with whatever is chosen.

## 2. Inconsistent

**I1. The preview restored after a dismissed mint list is built by hand, not by `previewStep`. fix**
`createMachine.ts:1112-1138` beside `machine/resolveNext.ts:389-414` (pass 3 B6 made the one builder; its callers
are `resolveNext.ts:452`, `contextResolution.ts:876,943`, `transitions.ts:627`). The hand-built copies leave out
`recipientPubkey` and `recipientProfile`, so a handler dispatched from that data (the quote refresh, `:1206`) gets
a preview with no recipient. Commit: "Restore a preview through previewStep"; a flow test that asserts the restored step data exactly would gain the
two fields (not checked).

**I2. `EXECUTE` and `OPTION_CHOSEN` copy the same 90-line intent switch and have drifted. list**
`machine/transitions.ts:115-227` and `:271-359`. Only `EXECUTE` sets `paymentRequestLockPubkey` (`:144-146`, "the
amount screen must not offer it as a plain bearer-token send") and seeds `recipientPubkey` from the Nostr transport
(`:167-173`); a creq chosen from a BIP-321 option list gets neither. `OPTION_CHOSEN` clears seven fields
(`:257-268`) but not `amount`, `recipientPubkey` or `paymentRequestLockPubkey`, so a first option's amount survives
into an amountless second option. The cross-unit rule and its English sentence exist three times (`:125-140`,
`:275-290`, `createMachine.ts:1424-1437`). Test: BIP-321 with an invoice and a locked creq, choose the creq, expect
`constraints.paymentRequestLockPubkey`. Changes what the amount screen offers: owner's call.

**I3. "Every read of the wallet context below goes through `readContext`" is not true. list**
`createMachine.ts:1403-1415`. `confirmSend` reads `getContext()` (`:1965`) and `buildFallbackMintListItems` does
too (`:883`); the second is reachable inside an NFC tap after a unit switch (a tap that ends on `selectMint` with
no candidate), where the first rows are then built from the old unit's balances.

**I4. The machine logs a local-first decision the effect does not make. fix**
`createMachine.ts:1965-1977` recomputes `hasExactLocalProofs`/`localFirst` for one log line without the lock rule;
`effects.ts:1949-1960` owns the rule (`!p2pkLocked && …`) and logs it at `:1971`. A locked send with exact proofs
logs `localFirst: true` and then swaps. It also builds the proof suggestions twice per send. Commit: "Log the send
path once, where it is decided".

**I5. Host notifications are announced two ways again. fix**
`announcePayment` (`createMachine.ts:472-502`) handles every notification type; three sites loop by hand and filter
one type: NFC write failure (`:1925-1931`), ecash send (`:2011-2017`), mint quote (`:2070-2076`). The effects
return only that type at each site (`effects.ts:805-815`, `:498-546`), so the sides are identical. Commit:
"Announce every effect's notifications through announcePayment".

**I6. A failed delivery binding can hide its own error. fix**
`defaultOperations.ts:752-758`: `await mgr.ops.send.cancel(prepared.id)` is not guarded, so a cancel that throws
replaces the binding error. The rescue forty lines up states the rule ("a cancel failure must never mask the
original", `:240-249`) and has a test for it. Commit: "Keep the binding error when the cancel after it fails".

**I7. Comments that describe code that is gone or elsewhere. fix**
- `defaultOperations.ts:614` "`executeSend` throws before prepare": the gate moved inside the rescue (`:771-777`)
  and now runs after prepare.
- `defaultOperations.ts:2158-2160` header "Receive history lookup helper" sits over
  `buildSyntheticPaymentRequestEntry`.
- `createMachine.ts:260-265`: history ("Previously each site cast through `as any`") and "the only legal seam",
  while `mirrorRecipientOntoStepData` assigns `stepData` directly (`:557`, `:567`).
- `createMachine.ts:777`: a one-line "Helper:" comment left above the doc comment that replaced it.
- `createMachine.ts:1486`: "A missing/unsupported host switch keeps the existing unit hard-stop" sits inside the
  branch where the switch exists.
- `createMachine.ts:388-392`: "the machine stays held while `restartFlow` runs" holds only if a turn was running.
- `effects.ts:1375`: "degrades to today's pay-then-quote shape".

**I8. `wallet/docs/STATE_MACHINE.md` and `wallet/README.md` against the code. fix for the first four**
- Line references are from a file half the size: `send(event)` at `createMachine.ts:547-1219` (`:159`; it is
  `:2247`, the turn `:1051-2245`), `INPUT_STEPS` at `163-170` (`:336`; now `:85-93`), `RESET` at
  `transitions.ts:393-394` (`:1004`, `:1110`; now `:722`), all `effects.ts:` cites. Commit: name the function, drop
  the numbers.
- `:339-341` and `:880` say `inspect()` keeps its reference unless the state changed. `notify`
  (`createMachine.ts:332-338`) builds a new object every time (see E1).
- `:895` gives `forceLocalSend` as two terms; the code has three and the lock (`effects.ts:1953-1957`); `:1095` of
  the same document says three.
- `README.md:95`: `machine.scan(undefined, { source: 'paste' })` does nothing: with no data only `clipboard`,
  `gallery` and `nfc` have a source function (`createMachine.ts:2331-2343`). `'clipboard'` is meant.
- The methods table (`:155-178`) has no `startSend`, `showReceiveQr` or `chooseSendFallback`. **list**
- README and CONVENTIONS import from `colada` and `colada/react`; the package is `wallet`. **list** (C1's question).

**I9. Three ways to compare mint URLs inside the package. list**
`transport/plan.ts:8` (`normalizeMintUrl`, headed "Mesh transport", lower-cases the path, builds a debug log
payload on every call) is what the Nostr payment-request checks use (`defaultOperations.ts:1918`, `:1971`);
`payment-request.ts:27` (`canonicalMintUrl`, parses the URL, drops default ports, keeps path case) is what the
request reader uses; Coco exports its own. No failing case was found, because the reader canonicalizes first.

**I10. Receive and mint-quote lookups do one job three ways. fix for the two identical pairs**
- `receiveOperations.ts:86-88` `receiveHistoryId` rebuilds Coco's `operationHistoryId("receive", id)`, which
  `defaultOperations.ts:2137` imports. Identical.
- `receiveOperations.ts:267-277` re-implements `proofsHaveP2PK` (`p2pk/secret.ts:49`), which
  `defaultOperations.ts:1393` calls. Identical.
- A send is found by id (`defaultOperations.ts:118`), a receive by id then by page and set difference
  (`receiveOperations.ts:96-109`), a mint quote only by scanning pages (`:522-532`). **list**: F181 holds the
  set-difference half.
Commit: "Use Coco's history id and the shared P2PK check in the receive operation".

**I11. Fourteen `BTC-nn` ids in comments name a list that is not in the repo. list**
About sixty mentions across `wallet/src`, `wallet/__tests__` and `app/features/send` (`BTC-05` twenty times). No
document defines them. Owner decides: restore the list, or replace each id with the sentence it stands for.

**I12. Twin helpers. fix**
- `effects.ts:484-496`: `createOfflineMintQuoteError` and `createOfflineSendError` differ only in the log name.
- `defaultOperations.ts:786-808` and `:842-862`: the "history row, or an entry built from the operation" tail of
  `executeSend` and `executeOfflineSend`, identical but for the log prefix.
Commit: "One offline error and one send-entry tail".

**I13. The fallback receive entry gets two different local ids. list**
`receiveOperations.ts:201` and `:204` call `newLocalId('redeemed')` twice, so `id` and `legacyHistoryId` differ;
the mint-quote fallback uses one id for both (`:502-505`). The id reaches annotations (saved).

**I14. Names that no longer fit. list (F19 holds renames)**
`machine/selectMintContext.ts` holds one type, `MintAvailability`. `classifyMeshRedeemError` decides whether an
ordinary receive is pending or failed (`receiveOperations.ts:81-84`). `toSatDenominated` logs `lnurl.convert` for
onchain and BOLT 12 amounts (`defaultOperations.ts:690`). `resetInternal` leaves `sendFallback` set
(`createMachine.ts:310-319`, `:689`); harmless because `chooseSendFallback` checks the step.

## 3. Inefficient (listed, none measured)

**E1.** `notify()` replaces the `inspect()` snapshot on every call (`createMachine.ts:332-338`), including exits
where nothing changed (`transition.unchanged`, `:1537`). `useExecutionState` hands that object to
`useSyncExternalStore`, so `MintSelectFlowScreen` and `AmountFlowScreen` re-render on every notification: at
least two per turn (`setExecuting(true)`, `finishTurn`), more for a send.

**E2.** `precreatedMeltQuotes` (`defaultOperations.ts:699-705`) is emptied only by `executeMelt`. Every preview
that is left, and every expired quote that is refreshed, leaves its quote in the map for the session.

**E3.** Each receive and each mint quote reads `getPaginatedHistory(0, 100)` before it starts and again per poll
(`receiveOperations.ts:249`, `:101`, `:470`, `:524`), up to 50 polls at 200 ms. The mint quote never asks for its
row by id, which the send path does in one read.

## 4. No longer needed

**N1. The `RESET` event has no sender. list**
`machine.reset()` calls `resetInternal`; nothing in `app/`, `wallet/src` or the e2e scenarios sends
`{ type: "RESET" }`. It still has a union member (`machine/types.ts:632`), a row in `INTENT_EVENTS` and
`LEAVES_SETTLED_PAYMENT` (`createMachine.ts:135`, `:149`), a `transition` case (`transitions.ts:722`), three tests
(`unit/transitions.test.ts:128,137,1718`) and five mentions in STATE_MACHINE.md. `send` is public, so removing it
deletes tests of behaviour that still exists: owner's call.

**N2. Result fields nobody reads. fix for the first two**
- `effects.ts:880`: `'forcedLocalProbe'` is never passed (one hit in the repo).
- `effects.ts:121-124`, set at `:1062-1065` and `:1088-1091`: the `context` patch on a stale send result; the
  machine returns on stale before it reads `context` (`createMachine.ts:1996-1997`).
- `target` and `pubkey` on the stale, empty and failed recipient results (`effects.ts:253-293`), `type` on
  `MachineEffectLink` (one value), `rolledBack` and `cause` on the NFC error: read only by
  `unit/machine-effects.test.ts` (`toEqual({ kind: 'stale', pubkey })`). **list**

**N3. `listedMints` is an alias of `allTrustedMints`. fix**
`defaultOperations.ts:1056`, left when the filter between them went (the comment above it says every trusted mint
is listed); the log prints both counts (`:1134-1135`). Commit with N5.

**N4. The package's own `executeReceive` and `executeMintQuote` never run in the app. list**
`defaultOperations.ts:1377-1440`, `:865-925` and `findReceiveHistoryEntry` (`:2181-2205`), about 150 lines. The
only host replaces both (`app/features/send/providers/Colada.tsx:554-561`) with `receiveOperations.ts`, whose
header calls these "the plain versions". They are reached by `unit/default-operations.test.ts` and
`integration/operations.test.ts`. Same question as C1: is the package meant to work without the app?

**N5. Small leftovers. fix**
`void task;` before `return task` (`createMachine.ts:965`); `origin?.nfc` re-checked after the tap was built from
it (`:1399`); `currentCtx.unit ?? "sat"` on a required field (`transitions.ts:276`); `info?.` after
`if (!info) throw` (`defaultOperations.ts:2024`);
`contextPatch?.mintUnreachableConfirmed === true || effectiveContext…` where the second contains the first
(`effects.ts:1076-1078`). Commit: "Remove checks the lines above already made".

**N6. Four exports with no reference anywhere, tests included. list (C1)**
`isUnitRateUnavailableError` (`errors.ts:147`), `isMintMethodCompatible` (`mint-capabilities.ts:642`),
`methodContextHasCompatibleMint` (`:1042`), `MachineSnapshot` (`machine/types.ts:515`). Knip cannot see them
because `index.ts` re-exports them. Eleven more are reached only by tests (`checkWalletCapabilities`,
`checkAllCapabilities`, `groupTimeline`, `selectMintForMelt`, `getRoundedFiatMinorUnitForSats`,
`getSatRangeForDisplayedFiatMinorUnit`, `generateCashuMnemonic`, `isValidCashuMnemonic`,
`registerPaymentCopyLocale`, `firstAnnotationRecord`, `getLocation`).

## 5. Regrown (in `createMachine.ts`, from passes 2 and 3)

**G1. A list, three helpers and a reset rule for a value that is always zero or one holder. fix**
`pendingPaymentRequestConfirms` (`:294-296`), `registerConfirm`, `unregisterConfirm`, `takeConfirms`
(`:427-447`, one caller each), cleared in `abandonTurn` (`:397`). `confirmPaymentRequest` registers and calls
`send` in the same synchronous stretch (`:2502-2506`); `runTurn` reaches `takeConfirms` (`:1065`) before its first
await and with no callback in between, and a dropped turn returns at once into the `finally` that unregisters. So
the list never holds two, and is empty whenever a reset runs. `runTurn` already takes `origin` this way: pass the
holder as a third argument. Commit: "Hand a confirm's result holder to its own turn".

**G2. `finishTurn`'s `{ notify: false }` exists to keep three old exits' notification counts. list**
`:373-386`, used at `:1089`, `:1377` and as a literal at `:396` beside the `QUIET_EXIT` constant. At `:1377` the
turn has already notified twice (`:1371`, `:1374`); at `:1089` nothing changed; at `:396` `reset()` notifies on
the next line (`:2514`). Its twin is `setExecuting(value, announce = true)` (`:400-403`), called four times as
`(false, false)`. Tests count notifications, so dropping the option is the owner's call.

**G3. `abandonTurn(restartFlow)` has one caller and a callback. list**
`:393-398`, called from `resetInternal` (`:311-314`). The callback sets two variables and sends no event; the
`finishTurn` inside checks staleness against the generation it has just written.

**G4. `settledPayment` carries two log labels per rail to reproduce two deleted tails. list**
`:1161-1165`, `:1263-1267`, `:1357-1361`, used at `:1369-1377`. `fromStep` is always the literal step of its
branch; `finalize` and `unlock` are strings for the stale log.

**G5. `advanceNfc` returns a boolean its own comment says is never false. list**
`:1662-1685`; five call sites `break` on it (`:1723`, `:1799-1805`, `:1821-1828`, `:1881`) and `:1953` invents an
end for the loop that left without one.

**G6. The safety net finishes a turn the inner `finally` has already finished. list**
`:2233-2243`: when a handler throws, `finishTurn` runs at `:2236`, the throw reaches `:2238`, and `finishTurn` runs
again with a second notification. Because a generation names a flow and not a turn (B1), a listener that sends an
event on the first notification would have its new turn's lock freed by the second call. No such listener is
known.

**G7. `deriveExecutionState` always returns `isExecuting: false`, which `notify` overwrites. list**
`:99-106`, `:332-336`, `:308`. Left by A5; it could take the flag.

## Not read

- `machine/resolveNext.ts`, `contextResolution.ts`, `amountFallback.ts`, `types.ts`, `flows/*` beyond `previewStep`,
  the member lists and the sites cited.
- `screen-actions/*` (`availability.ts`, `defaultHandlers.ts`, `session.ts`, `createManager.ts` beyond `:690-840`),
  `amount-actions/*`.
- `rebalance/*`, `legacy-ecash/*`, `chain/*`, `lnurl.ts`, `nip05.ts`, `offline.ts`, `mint-capabilities.ts`,
  `mint-selection.ts`, `parse.ts`, `detectors.ts`, `guards.ts`, `intent.ts`, `annotate.ts`, `annotations/*`,
  `history/*`, `copy/*`, `formatting/*` (locale keys were checked for use: all 27 are used), `subscriptions/*`,
  `wallet-seed.ts`, `payment-request*.ts`, `p2pk/*`, `core/*`, `quotes/reusable.ts`, `transport/classify.ts`,
  `transport/redeemEntry.ts`.
- `react/*` beyond the provider's props and context value, `useExecutionState.ts` and a reader count for each
  context field (all are read).
- `wallet/docs/STATE_MACHINE.md` beyond the lines cited; `CONVENTIONS.md` and `README.md` beyond the provider and
  example sections. `wallet/__tests__` only where a finding needed it.
- Coco internals: whether a failed `send.execute` keeps its reservation without a cancel (B2 relies on the comment
  at `defaultOperations.ts:203-209` and the test beside it), and whether projected history can miss (B4).
- No test file was run; one script outside the repo ran the machine for B1. Nothing on a device.
