# Colada State Machine Expectations

Authoritative reference for the Colada `PaymentMachine` and its
screen-action seam. Read this before changing any payment flow. It is
source-accurate and describes shipped behavior only.

## 1. Purpose and how to use this document

The Colada payment subsystem turns a user intent (scan, paste, enter an amount,
press confirm) into a deterministic sequence of `FlowStep`s, executes wallet I/O
through app-provided `operations`, and fires fire-and-forget `notifications`.
This document is the contract for that subsystem: the steps, the destinations,
the machine methods, the operation network semantics, and the invariants that
must not regress.

Use it to:

- Understand which owner is responsible for a behavior before editing it.
- Find the source file that holds a contract before changing it.
- Check, per flow, the exact step ordering, failure routing, and offline
  behavior.
- Separate shipped behavior (Sections 2-10) from intended contracts and current
  gaps (Section 11) before assuming a flow already behaves as designed.

### Prime rule

When you change a flow, update this document and its invariant in the same
change. A silent divergence between this doc and the code is itself a
regression. The offline-send break documented in Section 7 is the canonical
example of why this rule exists: the machine contract was correct, an
out-of-package wallet I/O change broke it, and the invariant was the only thing
that named the contract.

### Design philosophy

Three principles shape the flows below; cite them when a change would violate
one.

- Avoid terminal errors. Before the `error` step, the machine tries to help the
  user reach a send: round-up / round-down (`chooseProofs`), an offline exact
  send, a no-valid-mint round-down fallback (`buildChooseAmountFallback`,
  `resolveNext.ts:489-513`), or a BIP321 fallback option. A hard `error` is the
  last resort, not the first.
- Never force a mint or a flow on a QR scan. Auto-picks (a pre-set valid mint, a
  single full-amount candidate, the recommended option) are DEFAULTS the user
  can still change via the global `machine.requestMintSelector()`; multi-option
  inputs land on `chooseOption`, not a pinned method.
- NFC is the deliberate exception. A tap has no UI, so the NFC path forces ecash,
  auto-resolves option / mint, skips the memo, and auto-rolls-back on failure
  (Section 5.6). Document its tradeoffs; do not generalize them to QR.

### Conventions used here

Owners are disambiguated in prose:

- `machine.x` -- a method on the `PaymentMachine` (Colada owns sequencing).
- `handler.x` -- an app-provided `StepHandlerMap` callback Colada dispatched.
- `operations.x` -- wallet I/O Colada called (the app owns the implementation).
- `notifications.x` -- an optional side-effect callback Colada fired.
- `boundActions.x.execute()` -- a screen invoked a bound action from
  `useScreenActions`.

Source paths are relative to the Colada package root.

## 2. Ownership boundary table

| Concern | Owner | Where |
| --- | --- | --- |
| Payment-flow sequencing (`FlowStep` ordering, `resolveNext`/`resolveFromContext`/`transition`) | Colada owns | `src/machine/*` |
| Step copy defaults, error-code-to-copy resolution | Colada owns | `src/formatting/locales.ts` |
| Screen-action availability and default handlers | Colada owns | `src/screen-actions/availability.ts`, `defaultHandlers.ts` |
| Typed subscription / notification dispatch and the subscribe bus | Colada owns | `src/machine/createMachine.ts`, `src/subscriptions/*` |
| Default operations wiring (`createDefaultOperations`) | Colada owns the wiring; the app owns the Coco manager | `src/operations/defaultOperations.ts` |
| Wallet I/O implementations (`operations.*`), Coco manager instance | the app owns | injected via `MachineOperations` |
| Routes, navigation, UI components, screens | the app owns | sovran-app |
| Persistent stores, profile state, preferred/NPC mint persistence | the app owns | reacts to `onPreferredMintChanged` / `onNpcMintChanged` |
| Platform adapters (clipboard, share, NFC, scan sources) | the app owns | `src/adapters/types.ts` |
| Secret storage, seed derivation, P2PK key rotation policy | the app owns | reacts to `onP2PKReceiveCompleted` |
| `linkTransaction`, `sendNostrDM`, `resolveRecipientProfile` | the app owns | not implemented in `defaultOperations.ts:10-11` |
| Offline detection source (`getOffline`) | the app owns the value; Colada owns the routing | `src/core/createColada.ts`, `effects.ts:1181` |

Colada is agnostic of `@cashu/coco-core`: `ScreenActionContext.manager` is typed
`unknown` and the wallet casts it (`src/screen-actions/types.ts`). Colada must
not import Expo, Nostr-pool, storage, or chain libraries directly.

## 3. Core vocabulary

### 3.1 Steps

`FlowStep` (`src/machine/types.ts:19-38`). Terminal here means
`deriveExecutionState` settles it to `ready`/`READY` or `blocked` and no further
machine transition is expected from the step itself.

| Step | Purpose | Input step | Terminal |
| --- | --- | --- | --- |
| `idle` | Reset resting state; `ready`/`READY`, `isExecutable:true`. No handler. | no | no |
| `chooseOption` | BIP321 multi-option selection. `needsInput`/`OPTION_SELECTION_REQUIRED`. | yes | no |
| `chooseFallbackOption` | BIP321 fallback after an option failed. `FALLBACK_OPTION_REQUIRED`. | yes | no |
| `enterAmount` | Amount entry. `needsInput`/`NO_AMOUNT`. | yes | no |
| `selectMint` | Mint selection. `MINT_SELECTION_REQUIRED`. Seeds fallback rows, runs `operations.buildMintListItems`. | yes | no |
| `chooseProofs` | Offline proof round-up/round-down. `PROOF_SELECTION_REQUIRED`. | yes | no |
| `enterSendMemo` | Optional ecash token memo (only when `enableEcashSendMemo`). `SEND_MEMO_REQUIRED`. | yes | no |
| `confirmSend` | Action step for ecash send. Intercepted -> `runConfirmSendEffect`. | no | no (internal) |
| `sendComplete` | Terminal success of ecash send. Carries `historyEntry`, `createdOffline?`, `mintWasOffline?`. | no | yes |
| `createMintQuote` | Action step for Lightning receive. Intercepted -> `runMintQuoteEffect`. | no | no (internal) |
| `mintQuoteCreated` | Terminal success of mint-quote creation. | no | yes |
| `navigateToMeltPreview` | Lightning melt preview/confirm; `CONFIRM_MELT` executes in place. | no | yes |
| `navigateToPaymentRequest` | Payment-request preview/confirm; `CONFIRM_PAYMENT_REQUEST` executes in place. NFC auto-execute target. | no | yes |
| `receiveToken` | Token redeem step. Reached from intent and from `MINT_TRUSTED`. | no | yes |
| `reviewMint` | Mint trust-review before redeeming from an untrusted mint. | no | yes |
| `openMint` | Open a mint info screen (non-trust-review). | no | yes |
| `openProfile` | Open a Nostr profile screen. | no | yes |
| `navigateToReceive` | Open the receive hub (`START_RECEIVE`). | no | yes |
| `dismiss` | Persist-only / dismiss terminal (`MINT_SELECTED` with no destination). | no | yes |
| `error` | Error terminal. `deriveExecutionState` -> `blocked`. Dispatches `notifications[code]`. | no | yes |

`confirmSend` and `createMintQuote` have no `deriveExecutionState` case; when
`operations` are present the machine intercepts and re-targets them to a result
or error step before settling, so they read as `ready`/`READY` only transiently.
Without `operations`, the step is dispatched to the app step handler instead.

### 3.2 Destinations

`type Destination = AmountEntryConstraints['destination']`
(`src/machine/types.ts:40`). Carried on `FlowContext.destination`. Concrete
shipped values:

| Destination | Meaning | Balance required | Terminal step |
| --- | --- | --- | --- |
| `sendEcash` | Ecash send. Only destination that uses the offline proof picker. | yes | `confirmSend` (or `enterSendMemo`) |
| `meltQuote` | Lightning melt (invoice / LN address / lnurlp / onchain). | yes | `navigateToMeltPreview` |
| `paymentRequest` | Cashu NUT-18 payment-request send. | yes | `navigateToPaymentRequest` |
| `mintQuote` | Lightning receive (mint quote). No balance check. | no | `createMintQuote` |

Other carriers:

- `scope` (`'npc' | 'selected'`) on `selectMint` data / `MINT_SELECTED` /
  `REQUEST_MINT_SELECTOR`. `'npc'` updates the NPC mint and fires
  `onNpcMintChanged`; `'selected'` updates `selectedMint`. `'npc'` also forces
  NUT-17 websocket filtering in `buildMintListItems`.
- `mintQuoteMethod` / `meltQuoteMethod` (`'bolt11' | 'onchain'`).
  `executeMintQuote` throws on `'onchain'` and always prepares with `'bolt11'`.

### 3.3 Machine methods

`PaymentMachine` (`src/machine/types.ts`). All dispatch through `send(event)`,
guarded by `sendLocked`.

| Method | Wraps | Notes |
| --- | --- | --- |
| `send(event)` | core dispatcher | `createMachine.ts:547-1219` |
| `execute(input, {reset?})` | `EXECUTE` | `{reset}` calls `resetInternal` first |
| `scan(data?, opts?)` | `processScanData` -> `execute` | OPTIONAL; present only with `createURDecoder`/`scanSources` |
| `enterAmount(amount, mintUrl, opts?)` | `AMOUNT_ENTERED` | carries destination, methods, offline, meltTarget, recipients, display |
| `chooseOption(option)` | `OPTION_CHOSEN` | |
| `chooseProofs(amount)` | `PROOFS_CHOSEN` | |
| `submitSendMemo(memo?)` | `SEND_MEMO_SUBMITTED` | |
| `changeMint(mintUrl, {persist?, scope?})` | `MINT_SELECTED` | the mint-selection method is `changeMint`; there is no `selectMint` method |
| `requestMintSelector({reset?, scope?})` | `REQUEST_MINT_SELECTOR` | |
| `startSendEcash({reset?, meltTarget?, recipientPubkey?, recipientProfile?})` | `START_SEND_ECASH` | |
| `startReceiveLightning({reset?})` | `START_RECEIVE_LIGHTNING` | |
| `startReceive({reset?})` | `START_RECEIVE` | |
| `reviewMint(mintUrl, token)` | `REVIEW_MINT` | |
| `mintTrusted()` | `MINT_TRUSTED` | then runs `operations.trustMint` |
| `confirmMelt()` | `CONFIRM_MELT` | runs `operations.executeMelt` in place |
| `confirmPaymentRequest()` | `CONFIRM_PAYMENT_REQUEST` | returns `{rolledBack}` |
| `reset()` | `resetInternal` + notify | |
| `inspect()` | cached `ExecutionState` | the snapshot accessor is `inspect`, not `getSnapshot` |
| `getContext()` | current `FlowContext` | |
| `getStep()` | current `FlowStep` | |
| `subscribe(listener)` | state-change bus | returns unsubscribe |

React hooks: `usePaymentMachine` (low-level) and `usePaymentFlowMachine`
(provider-bound, re-exported from `react/index.ts`); both return
`PaymentMachine`. `useScreenActions` returns
`{entry, error, actions, mintUrl, source, suggestions}` where `actions[name]` is
a `BoundAction` with `.execute(params?)`.

### 3.4 Operations

`MachineOperations` (`src/machine/types.ts`). "Owner" = `app` means the default
is not implemented in `defaultOperations.ts`.

| Operation | Purpose | Network use | Default owner |
| --- | --- | --- | --- |
| `executeSend` | Ecash send (prepare+execute, mint swaps server-side). Required. | always | Colada default |
| `executeOfflineSend` | Local-proof-only send; throws on `needsSwap`. Optional. | never (by design) | Colada default |
| `executeMintQuote` | Create mint (Lightning receive) quote (`bolt11`). Required. | always | Colada default |
| `buildMintListItems` | Build Select-Mint rows. Required. | conditional (per-mint info, catalog) | Colada default |
| `trustMint` | `addMint(mintUrl, {trusted:true})`. Optional. | conditional | Colada default |
| `buildMintReviewInfo` | Load trust-review detail. Optional. | conditional (mint info, Nostr, reviews) | Colada default |
| `executeMelt` | Lightning melt (LNURL resolve + prepare+execute). Optional. | always | Colada default |
| `executePaymentRequest` | Create token + deliver over Nostr/HTTP; rollback on delivery failure. Optional. | always | Colada default |
| `linkTransaction` | Link scanned input to a transaction id. Optional. | never (local) | app |
| `executeNfcSend` | NFC POS token creation. Optional. | always | Colada default |
| `rollbackSend` | Roll back a pending send. Optional. | conditional | Colada default |
| `checkSendStatus` | Poll a pending send. Optional. | conditional | Colada default |
| `executeReceive` | Redeem an ecash token (`wallet.receive`). Optional. | always | Colada default |
| `rollbackMelt` | Cancel a melt operation. Optional. | conditional | Colada default |
| `isMintTrusted` | Trusted-mint lookup. Optional. | never (local) | Colada default |
| `sendNostrDM` | NIP-17 gift-wrapped DM. Optional. | always | app |
| `resolveRecipientPubkey` | LN target -> Nostr pubkey via NIP-05. Optional. | always | Colada default |
| `resolveRecipientProfile` | Pubkey -> kind-0 profile. Optional. | always | app |

### 3.5 Notifications

Fire-and-forget callbacks (`src/machine/types.ts:438-672`). A missing handler is
an intentional no-op; the machine never depends on the result. Keyed by name
(below) plus one entry per `ErrorCode`.

`onScanEmpty`, `onScanError`, `onScanResolved`, `onMissingMintForAmount`,
`onCopied`, `onShared`, `onPaymentProcessing`, `onPaymentConfirmed`,
`onPaymentFailed`, `onNfcPaymentProgress`, `onNfcWriteFailed`,
`onSendStatusChecked`, `onSendCancelled`, `onSendCancelFailed`,
`onReceiveProcessing`, `onReceiveConfirmed`, `onReceiveFailed`,
`onMeltCancelled`, `onMeltCancelFailed`, `onUnsupportedTokenUnit`,
`onMintTrustedFromScreen`, `onPreferredMintChanged`, `onNpcMintChanged`,
`onTransactionCreated`, `onP2PKReceiveCompleted`, `onMeltQuoteCreated`.

`onPaymentFailed` is fired by `routeOperationFailure` on EVERY melt /
payment-request operation failure (so the processing notification clears),
BEFORE any BIP321 fallback is computed (`createMachine.ts:451-459`). It is NOT a
signal that the flow has given up -- a `chooseFallbackOption` step may follow.

### 3.6 Events

All 15 `FlowEvent` types are dispatched via `send()`
(`src/machine/types.ts:355-412`):

`EXECUTE`, `OPTION_CHOSEN`, `AMOUNT_ENTERED`, `MINT_SELECTED`, `PROOFS_CHOSEN`,
`SEND_MEMO_SUBMITTED`, `REQUEST_MINT_SELECTOR`, `START_SEND_ECASH`,
`START_RECEIVE_LIGHTNING`, `START_RECEIVE`, `REVIEW_MINT`, `MINT_TRUSTED`,
`CONFIRM_MELT`, `CONFIRM_PAYMENT_REQUEST`, `RESET`.

Global events (handled from any state, `transitions.ts:390-441`): `EXECUTE`,
`RESET`, `REQUEST_MINT_SELECTOR`, `SEND_MEMO_SUBMITTED`, `START_SEND_ECASH`,
`START_RECEIVE_LIGHTNING`, `START_RECEIVE`, `REVIEW_MINT`, `MINT_TRUSTED`.
State-specific events (`transitions.ts:444-453`): `OPTION_CHOSEN`,
`AMOUNT_ENTERED`, `MINT_SELECTED`, `PROOFS_CHOSEN`. These four are not actually
state-gated inside `transition()`; the second switch only lists events not
caught by the first. `CONFIRM_MELT` and `CONFIRM_PAYMENT_REQUEST` bypass
`transition()` entirely and are handled directly in `send()`.

### Error codes

`ErrorCode` (`src/machine/types.ts:194-209`): `NO_AMOUNT`, `NO_VALID_MINT`,
`INSUFFICIENT_BALANCE`, `NO_BALANCE`, `UNSUPPORTED_INPUT`,
`UNSUPPORTED_PAYMENT_METHOD`, `ALL_OPTIONS_DISABLED`, `MISSING_MELT_TARGET`,
`SEND_FAILED`, `MINT_QUOTE_FAILED`, `MELT_FAILED`, `PAYMENT_REQUEST_FAILED`,
`NFC_WRITE_FAILED`, `NFC_SESSION_LOST`, `NFC_READ_FAILED`. `deriveExecutionState`
maps the `error` step to `status:'blocked'`; codes outside the allowlist fall
back to `UNSUPPORTED_INPUT` (`createMachine.ts:119-134`).

## 4. Machine lifecycle

### How a turn flows

```
send(event)
  -> sendLocked acquired; sendGeneration = flowGeneration (snapshot)
  -> resolve offline once: offline = getOffline?.() ?? false   (createMachine.ts:777)
  -> CONFIRM_MELT / CONFIRM_PAYMENT_REQUEST: handled directly in send()
  -> else transition(event, step, ctx, ...)
        handleExecute / handleAmountEntered / handleMintSelected / ...
        -> resolveNext(intent, ctx, walletCtx) | resolveFromContext(ctx, walletCtx)
        -> stamp offline onto every result.context
        -> {step, context, data}
  -> setStep(step, data); flowCtx = merged context
  -> if step is confirmSend/createMintQuote AND operations present:
        intercept -> run async effect -> setStep(result | error)
  -> if step not in INPUT_STEPS: handlerExecuting=true; notify();
        dispatchHandler(step, data); handlerExecuting=false; notify()
  -> if step === 'error': fire notifications[code] fire-and-forget
  -> sendLocked released
```

Gather order is fixed: amount -> mint -> proofs -> terminal
(`resolveNext.ts:256-264`).

### Generations and staleness

`flowGeneration` is incremented ONLY in `resetInternal`
(`createMachine.ts:227`). A plain `send()` does not bump the generation; it
snapshots it (`sendGeneration = flowGeneration`). Every async effect captures
`isStale = (op) => isStaleGeneration(sendGeneration, op)`. After any `await`, a
stale generation returns `kind:'stale'` and the machine returns early without a
`setStep`. This is the guard that stops a superseded send/quote (after `reset()`,
`startX({reset:true})`, or `execute(..,{reset:true})`) from clobbering newer
state or double-firing notifications. A newer EXECUTE without `reset` runs at the
same generation and does NOT supersede an in-flight effect by generation.

### handlerExecuting / notify cycle

`INPUT_STEPS` (`createMachine.ts:163-170`) gate `isExecuting`: no spinner while
the user is inputting. For all other steps, `handlerExecuting` is toggled
`true`/`false` around the handler dispatch with a `notify()` on each edge, so the
screen sees a loading edge for action and navigate steps. `inspect()` returns a
stable reference between notifications and only promotes a new reference when the
`ExecutionState` actually changes.

### Recipient resolution

`recipientPubkey`/`recipientProfile` are populated by fire-and-forget resolvers
(`maybeResolveRecipient`, `createMachine.ts:326-422`): stage 1 `meltTarget` ->
pubkey via `operations.resolveRecipientPubkey` (NIP-05), stage 2 pubkey ->
profile via `operations.resolveRecipientProfile`. Both REPLACE the `flowCtx` /
step-data references (never mutate) for `useSyncExternalStore` diffing, and
mirror identity onto step data via `mirrorRecipientOntoStepData`. Stage 2 has NO
shipped default (`defaultOperations.ts:1044-1047`) and is hard-gated on
`operations.resolveRecipientProfile` (`createMachine.ts:387`); out of the box a
scanned lightning address resolves only a bare pubkey -- the app owns kind-0
profile resolution. See Section 11.8.

## 5. Per-flow expectations

### 5.1 Send ecash

Intent: send a Cashu ecash token from a trusted, funded mint. Gather amount +
mint; for an offline send that does not compose exactly, route to `chooseProofs`;
execute via the manager. Online sends let the mint swap server-side; offline /
local sends require an exact proof match.

```
START_SEND_ECASH / EXECUTE / AMOUNT_ENTERED
   -> enterAmount? -> selectMint? -> chooseProofs? (offline, non-exact only)
   -> enterSendMemo? (enableEcashSendMemo && !sendMemoHandled)
   -> confirmSend  -- intercepted --> runConfirmSendEffect
        path A localFirst   (exact local proofs + executeOfflineSend) -> executeOfflineSend
        path B forceLocalSend (offline / localProofSend, no exact-first) -> handleConfirmSendFailure(synthetic MintFetchError)
        path C online       (default) -> executeSend
   -> sendComplete | chooseProofs (failure fallback) | error
```

| Effect / operation | When | Network |
| --- | --- | --- |
| `operations.executeOfflineSend` | localFirst, forceLocalSend offlineFallback | never |
| `operations.executeSend` | online (path C) | always |
| `notifications.onTransactionCreated` | on `sendComplete` | n/a |

Failure + fallback (`effects.ts:734-837`): an online `executeSend` failure with a
mint-offline cause + exact local proofs + `executeOfflineSend` runs the
offlineFallback send (`createdOffline:true`). A failure with non-exact proofs but
a round-up/round-down suggestion routes to `chooseProofs` instead of a hard
error. Otherwise `error` `SEND_FAILED` (message localizes to `MINT_UNREACHABLE`
with `data.mintUnreachable:true` when the cause is a mint-offline error). The
`chooseProofs` failure branch is NOT gated on `isMintOfflineError`; any send
failure with proofs present and a suggestion can surface it.

MUST:

- `checkProofComposition` runs only for ecash sends; melts and payment requests
  always attempt the exact amount. `resolveNext.ts:161`.
- Offline / local ecash send must have an exact composition; `executeOfflineSend`
  cancels the prepared op and throws on `needsSwap`. `defaultOperations.ts:386-394`.
- After `PROOFS_CHOSEN` the flow goes straight to the terminal step and does NOT
  re-enter `resolveFromContext`. `transitions.ts:282-329`.
- The offlineFallback path runs `executeOfflineSend` only when the cause is a
  mint-offline error, `executeOfflineSend` exists, `proofAmounts` is non-empty,
  and the amount is an exact local match. `effects.ts:753-763`.
- Every async send branch short-circuits to `stale` on a generation bump.
  `effects.ts:742,769,790,1196,1233`.
- `executeSend`/`executeOfflineSend` never return a tokenless entry; the history
  entry is enriched or synthesized to carry the token.
  `defaultOperations.ts:373-379,399-405`.

MUST NOT:

- Online ecash sends must not pre-show `chooseProofs`; only a send failure may
  surface it. `resolveNext.ts:166-169`.
- `mintUnreachableConfirmed` must not be set for a deliberate local/offline send
  (`forceLocalSend`) or a local-first attempt. `effects.ts:717-732`.
- The dev-only mock-fail send toggle must not take effect in production.
  `defaultOperations.ts:341-351`.

### 5.2 Lightning melt / pay

Intent: pay a Lightning destination (bolt11, LN address, lnurlp, onchain). Gather
amount + a balance-bearing, method-capable mint; preview
(`navigateToMeltPreview`); on `confirmMelt()` execute `operations.executeMelt` in
place. Offline melt is forbidden; there is no offline melt operation and no
`chooseProofs` for melt on the happy path. An over-balance melt is the one
exception: it routes through `chooseProofs` with a round-DOWN-only suggestion
(see Section 11.6).

```
EXECUTE (melt* intent) / AMOUNT_ENTERED(destination=meltQuote)
   -> enterAmount? -> selectMint? (balance + method-aware) -> navigateToMeltPreview
   -> CONFIRM_MELT -- in place --> operations.executeMelt
        success: setStep('navigateToMeltPreview', {...data, historyEntry})  (step STAYS)
        failure: routeOperationFailure -> chooseFallbackOption | ALL_OPTIONS_DISABLED | stay
```

| Effect / operation | When | Network |
| --- | --- | --- |
| `operations.buildMintListItems` | `selectMint` | conditional |
| `operations.executeMelt` | `CONFIRM_MELT` | always (LNURL resolve + mint) |
| `operations.rollbackMelt` | screen action `meltQuote.cancel` | conditional |

Failure + fallback: a single-option melt failure leaves the step on
`navigateToMeltPreview` so the user can retry Pay; no `error` step is set. A
BIP321 multi-option failure routes to `chooseFallbackOption` (failed option
disabled) or `error` `ALL_OPTIONS_DISABLED`. If `melt.execute` throws after
prepare, `executeMelt` cancels the melt operation to release reserved proofs,
then rethrows.

MUST:

- `executeMelt` resolves a non-bolt11 target via `requestInvoiceFromLnurl`
  before prepare. `defaultOperations.ts:744-748`.
- The LNURL bolt11 msat amount must equal `amount * 1000`, else
  `LNURL_INVOICE_AMOUNT_MISMATCH` is thrown before any mint melt. `lnurl.ts:268-279`.
- The LNURL callback must be https (or http only for `.onion`); `.onion` hosts
  throw `LNURL_TOR_REQUIRED` up front. `lnurl.ts:115-130,172-177`.
- On `CONFIRM_MELT` success the step stays `navigateToMeltPreview` with
  `historyEntry` merged. `createMachine.ts:634`; `effects.ts:504-510`.
- `executeMelt` rejects non-sat units. `defaultOperations.ts:118-121,737`.
- `resolveFromContext` meltQuote path errors `MISSING_MELT_TARGET` when
  `ctx.meltTarget` is absent. `contextResolution.ts:363-369`.

MUST NOT:

- Offline melt must remain impossible; `checkProofComposition` returns null for
  non-sendEcash. `resolveNext.ts:159-161`.
- `CONFIRM_MELT` must not execute unless `step === 'navigateToMeltPreview'` and
  `operations.executeMelt` is provided; otherwise it falls through `transition()`
  unchanged. `createMachine.ts:589`.
- Do not invent a `rolling_back` machine state. `MELT_FAILED` is a defined
  `ErrorCode` but the confirm-melt path never sets `error` with it for
  single-option flows.

Stuck-on-selectMint recovery: if the user dismissed the mint selector opened from
the preview, `CONFIRM_MELT` restores `navigateToMeltPreview` from ctx -- but ONLY
when both `flowCtx.mintUrl` and `flowCtx.amount` are truthy
(`createMachine.ts:565-587`). With no mint chosen yet the Pay tap is silently
dropped.

### 5.3 Mint / top-up (Lightning receive)

Intent: turn a `mintQuote` intent (amount + trusted mint) into a created bolt11
mint quote and a persisted `mint` history entry, then hand off. The machine
creates the quote only; it does NOT await invoice payment. The wallet's quote
watcher, keyed off `onTransactionCreated`, owns finalization.

```
START_RECEIVE_LIGHTNING -> enterAmount? -> selectMint? (trusted, no balance) -> createMintQuote
   createMintQuote -- intercepted --> runMintQuoteEffect
        offline gate FIRST: getOffline() -> error MINT_QUOTE_FAILED (no operation call)
        else operations.executeMintQuote(bolt11)
   -> mintQuoteCreated | error
```

| Effect / operation | When | Network |
| --- | --- | --- |
| `operations.buildMintListItems` | `selectMint` (all trusted, never balance-disabled) | conditional |
| `operations.executeMintQuote` | online only | always |

Failure + fallback: there is no BIP321 fallback and no `chooseProofs` for
mintQuote. A mint-offline failure online surfaces `MINT_UNREACHABLE` as a
terminal `MINT_QUOTE_FAILED`; no retry.

MUST:

- Offline mint quotes are rejected before any I/O; `executeMintQuote` is never
  called offline. `effects.ts:852-856`. This gate uses the machine `getOffline`
  provider only, NOT `ctx.offline`.
- Onchain mint quotes are unsupported; `executeMintQuote` throws on `'onchain'`
  and always prepares `'bolt11'`. `defaultOperations.ts:411-413,418`.
- Only `'sat'` is supported (`requireSatUnit`). `defaultOperations.ts:118-121`.
- The created quote invoice is UNPAID at creation; the machine never awaits
  payment. `defaultOperations.ts:437`.
- `onTransactionCreated` fires only when the parsed `historyEntry` has an id; a
  malformed entry silently drops the wallet's only minting handoff signal.
  `effects.ts:415-416`.

MUST NOT:

- `createMintQuote`/`mintQuoteCreated` are not `INPUT_STEPS`; the spinner is
  shown and the app handler is dispatched.

### 5.4 Receive / redeem token

Intent: redeem an incoming ecash token. The token resolves to `receiveToken` with
NO machine-level trust check; the app's `receiveToken.redeem` screen action runs
`operations.isMintTrusted` and either calls `operations.executeReceive` (trusted)
or routes through `reviewMint` -> `MINT_TRUSTED` -> `trustMint` ->
`receiveToken` (untrusted). This is distinct from `startReceive` /
`startReceiveLightning`, which GENERATE a receive address / quote and never touch
`executeReceive`.

```
EXECUTE(ecashToken) -> receiveToken                       (no trust gate here)
   boundActions.receiveToken.redeem.execute()
        unit !== 'sat' -> onUnsupportedTokenUnit; return
        isMintTrusted? false -> machine.reviewMint(mintUrl, token); return
        true -> onReceiveProcessing -> executeReceive -> onReceiveConfirmed
   reviewMint -> MINT_TRUSTED -> trustMint (same dispatch) -> receiveToken
        user presses Redeem AGAIN (isMintTrusted now true) -> executeReceive
```

| Effect / operation | When | Network |
| --- | --- | --- |
| `operations.isMintTrusted` | redeem trust gate | never (local) |
| `operations.buildMintReviewInfo` | entering `reviewMint` | conditional |
| `operations.trustMint` | `MINT_TRUSTED` | conditional |
| `operations.executeReceive` | redeem trusted path | always |
| `operations.linkTransaction` | redeem success | never (app-provided; default omits it) |

Failure + fallback: `executeReceive` failure fires `onReceiveFailed` and
RETHROWS; the machine step stays `receiveToken`. When no history row is found,
`executeReceive` returns a synthetic entry that deliberately omits the encoded
token. P2PK/amount detection failure is caught and only logged.

MUST:

- The redeem path must route an untrusted mint through
  `machine.reviewMint(mintUrl, token)` before `executeReceive`.
  `defaultHandlers.ts:224-232`.
- Redeem must reject non-sat tokens via `onUnsupportedTokenUnit`.
  `defaultHandlers.ts:212-217`.
- `MINT_TRUSTED` transitions to `receiveToken` only when `ctx.reviewToken` is
  present; otherwise it is a no-op. `transitions.ts:430-439`.
- `trustMint` runs in the SAME dispatch as `MINT_TRUSTED`; trust-then-redeem is a
  two-press loop and `MINT_TRUSTED` does NOT auto-redeem. `createMachine.ts:1151-1171`.
- The synthetic receive fallback must not echo the encoded token into
  `onTransactionCreated`. `defaultOperations.ts:714-727`.
- `linkTransaction` must prefer `flowCtx.rawInput` over the re-encoded token so
  the scan store can match `processed === raw`. `defaultHandlers.ts:261-269`.
- `resolveNext` short-circuits a `receiveToken` intent to
  `{step:'receiveToken', data:{token}}` before any gather phase.
  `resolveNext.ts:271-274`.

MUST NOT:

- There is no machine-level trust gate; the only gate is the app screen action.
  Removing the `isMintTrusted` check there silently allows redeeming against
  untrusted mints.

Note: the default operations do NOT supply `linkTransaction`
(`defaultOperations.ts:10-11`); out of the box, scan-history linking is a no-op.

### 5.5 Payment request (NUT-18)

Intent: parse a NUT-18 request (it may pin amount, unit, and an allowed mint
set), gather missing amount/mint, preview (`navigateToPaymentRequest`), then on
`confirmPaymentRequest()` create exact-amount ecash server-side and DELIVER over
the request's transport (Nostr DM or HTTP POST). On delivery failure with a
successful reclaim, surface `rolledBack` so funds are not lost and BIP321 flows
can fall back. The exact amount is always attempted; `chooseProofs` is
intentionally skipped.

```
EXECUTE(paymentRequest) / OPTION_CHOSEN(paymentRequest)
   -> enterAmount? -> selectMint? (supportedMintUrls-constrained) -> navigateToPaymentRequest
   -> CONFIRM_PAYMENT_REQUEST -- in place --> executePaymentRequest
        completed  -> step STAYS navigateToPaymentRequest, +historyEntry
        rolledBack -> settle(true); routeOperationFailure(..,{rolledBack:true})
        thrown     -> settle(false); routeOperationFailure(..)
   NFC: source==='nfc' on navigateToPaymentRequest -> runNfcWriteBackEffect -> sendComplete
```

| Effect / operation | When | Network |
| --- | --- | --- |
| `operations.buildMintListItems` | `selectMint` (out-of-set mints disabled `NOT_IN_PAYMENT_REQUEST`) | conditional |
| `operations.executePaymentRequest` | `CONFIRM_PAYMENT_REQUEST` | always (mint + Nostr/HTTP) |
| `operations.executeNfcSend` | NFC auto-execute | always |

Failure + fallback: a `rolledBack` result routes through `routeOperationFailure`
with `{rolledBack:true}` enabling `chooseFallbackOption` /
`ALL_OPTIONS_DISABLED`; single-option leaves the step put for retry. When the
mint history row is not yet persisted, a synthetic entry is built. The NFC path
terminates in `sendComplete` (token written to tag) and never calls
`executePaymentRequest`.

MUST:

- `checkProofComposition` returns null for `paymentRequest`; the proof picker
  must not be shown from the normal gate. `resolveNext.ts:158-161`.
- `CONFIRM_PAYMENT_REQUEST` is gated on `step === 'navigateToPaymentRequest'` AND
  `operations.executePaymentRequest`. `createMachine.ts:661`.
- On delivery failure the operation must attempt rollback (cancel if `prepared`,
  reclaim if executing/pending) and only return `rolledBack` when that
  cancel-or-reclaim succeeds; otherwise rethrow. The decision is taken at the
  transport call sites (`defaultOperations.ts:959-973` Nostr, `992-1006` HTTP)
  via the `attemptRollback` helper (`defaultOperations.ts:188-216`).
- `executePaymentRequest` re-decodes the request and throws
  `'Invalid payment request'` before creating any token.
  `defaultOperations.ts:910-916`.
- Nostr transport requires `config.sendNostrDM` and a resolvable effective
  amount. `defaultOperations.ts:927-936`.
- `ctx.supportedMintUrls` is set from `info.mints` ONLY when non-empty.
  `transitions.ts:49,129`.

MUST NOT:

- Do not reintroduce `chooseProofs` for payment requests; the mint swaps
  server-side.
- The dev-only mock delivery failure must not take effect in production.
  `defaultOperations.ts:341-351`.

Transport branch keys on `(nostrTransport && !httpTransport)`; a request
advertising both goes down the HTTP path.

### 5.6 NFC payment-request send (single tap)

Intent: complete a tap-to-pay with zero prompts. NFC is a `paymentRequest` send
specialized for no-UI execution; its tradeoffs are intentional (Section 1, Design
philosophy).

The `source === 'nfc'` block runs DURING the in-place transition
(`createMachine.ts:879-998`), BEFORE the operations-interception block
(`createMachine.ts:1003`) and the `CONFIRM_PAYMENT_REQUEST` handler
(`createMachine.ts:661`) can fire -- that is why no UI confirm step is shown. It
loops, auto-resolving each gathered step:

```
source==='nfc':
  chooseOption / chooseFallbackOption
       -> auto-pick: paymentRequest, else lightningInvoice, else first
          non-disabled  (createMachine.ts:888-890)
  selectMint
       -> auto-pick candidates[0] (highest-balance valid; honours the receiver
          supportedMintUrls and the preferred mint)  (createMachine.ts:912-913)
  enterAmount   -> taken from the request
  navigateToPaymentRequest + nfc
       -> runNfcWriteBackEffect -> executeNfcSend -> token written to tag
       -> sendComplete
```

| Effect / operation | When | Network |
| --- | --- | --- |
| `operations.executeNfcSend` | NFC write-back | always (mint) |
| `operations.rollbackSend` | NFC failure (not stale) | conditional |

MUST:

- NFC skips `enterSendMemo` entirely; it never prompts for a memo.
- On a genuine `executeNfcSend` failure the effect rolls back the pending send
  via `operations.rollbackSend` before surfacing the error (`effects.ts:1085`).

MUST NOT:

- NFC must not show a mint / option / memo / confirm prompt; the tap is the
  confirmation.

Known nuances:

- A STALE interruption (a newer flow superseded the tap) returns `stale` WITHOUT
  rolling back (`effects.ts:1081-1083`) and leaves the step unchanged
  (`createMachine.ts:962`) -- no `sendComplete`, no `error`. This differs from the
  failure path, which does roll back.
- An NFC failure goes straight to `error` (`createMachine.ts:979-986`); it does
  NOT enter `routeOperationFailure`, so there is no BIP321 fallback. Lightning
  fallback after an ecash NFC failure, and an auto offline-send range, are NOT
  implemented (Section 11.13).

## 6. Amount entry and proof selection

Two subsystems share the `composeSatoshis`/`composeFiat` primitives:

- Screen-side `AmountActionManager` (`src/amount-actions/*`): owns the keyboard
  string, sat/fiat mode, `canSendOffline`, and QuickSend suggestions.
- Machine-side `resolveNext` / `amountFallback` (`src/machine/*`): owns the
  `enterAmount` step and the `chooseProofs` round-up/round-down suggestions.

### sat vs fiat

`resolveAmount` converts a typed amount into `effectiveSatAmount`. In fiat mode
(btcPrice > 0) it auto-optimizes to an exactly-composable sat value inside the
+/-0.005 fiat rounding window when one exists, setting `autoOptimized`. The
fiat->sat toggle carries `effectiveSatAmount` (the auto-optimized value), not the
naive center, so an offline-composable amount survives the toggle
(`createManager.ts:223-231`). `toggle()`/`setMode()` are no-ops unless the fiat
toggle is available (both `fiatCurrency` and `fiatSymbol` truthy); `toggle()`
also requires btcPrice > 0.

`composeFiat` scans the HIGH end of the +/-0.005 window first
(`offline.ts:313`), so among several in-window exact matches it returns the
highest, not the fewest-proofs value -- there is no fee-aware tie-break. The
"insufficient funds at the same fiat" silent clamp is emergent and window-bounded
(Section 11.5): it only holds while the affordable maximum lands inside the fiat
window; below the window the flow routes to a round-down `chooseProofs` or a hard
`INSUFFICIENT_BALANCE`/`NO_BALANCE` error, not a silent send.

### canSendOffline

`canSendOffline` is `true`/`false` only when offline analysis applies; it is
`null` (not `false`) when `numericValue <= 0`, `offlineOptimization` is off,
there are no proofs, or btcPrice <= 0 in fiat mode (`resolve.ts:32,59-62,93`).
`compute()` reads proof amounts only when a mint is selected
(`proofAmounts = mintUrl ? getProofAmounts() : []`).

### QuickSend suggestions vs chooseProofs

| | QuickSend (screen) | chooseProofs (machine) |
| --- | --- | --- |
| Source | `computeQuickSendSuggestions` (`suggestions.ts`) | `buildProofSuggestions` (`amountFallback.ts:19-42`) |
| Shape | many distinct exactly-composable sat/fiat targets + trailing "Send all" | exactly two: `roundDown` (nearestLower < amount) and `roundUp` (nearestUpper > amount) |
| Guarantee | every entry is exactly composable | offered only when the typed amount is NOT exact |
| Screen | amountEntry | chooseProofs |

`buildProofSuggestions` has three machine consumers: the `chooseProofs` step, the
no-valid-mint fallback (`buildChooseAmountFallback`), and the `confirmSend`
local-first / offlineFallback decision (`hasExactLocalProofs`).

### Exact-match composition

`composeSatoshis` (`src/offline.ts:232-288`) decides `exactMatch`,
`nearestLower`, `nearestUpper`. It is defensive: empty/all-invalid coins yield
`exactMatch:false`, and any strategy throwing degrades to `{exactMatch:false}`
rather than crashing. Exact-match detection is what makes `localFirst` /
`offlineFallback` eligible.

MUST:

- `chooseProofs` via `checkProofComposition` is shown only for ecash sends that
  are offline. `resolveNext.ts:158-169`.
- QuickSend suggestions and "Send all" must be offline-composable.
  `suggestions.ts:95-145`.
- `inspect()` returns the previous reference when the resolution is structurally
  equal. `createManager.ts:187-194`.

## 7. Offline semantics (keystone)

Offline is a runtime predicate, not a stored mode.

### Detection plumbing

```
app provider getOffline()  --\
ctx.offline (stamped per event from getOffline, transitions.ts:385) --+--> collapse in runConfirmSendEffect
ctx.localProofSend (set when user accepts an exact proof suggestion) --/

appOffline      = getOffline() || context.offline === true
forceLocalSend  = appOffline || context.localProofSend === true     (effects.ts:1181-1182)
```

`getOffline` defaults to `() => false` if the app injects none. `ctx.offline` is
seeded at send start (`flows/send.ts:57`) and re-stamped on every event so fresh
contexts see the real-time value. `ctx.localProofSend` is set `true` by
`handleProofsChosen` when the user accepts an exactly-composable amount for a
sendEcash destination (`transitions.ts:279`).

### Three send paths

```
runConfirmSendEffect (effects.ts:1164-1255)
  |
  | hasExactLocalProofs = proofAmounts.length>0 && composeSatoshis exactMatch
  | shouldCreateLocalTokenFirst = hasExactLocalProofs && !!executeOfflineSend
  |
  +-- shouldCreateLocalTokenFirst? --YES--> Path A localFirst
  |        executeOfflineSend (runs even when ONLINE)
  |        -> sendComplete (createdOffline:true)
  |
  +-- forceLocalSend && executeOfflineSend (and not A)? --YES--> Path B forceLocalSend
  |        synthesize MintFetchError (createOfflineSendError)
  |        -> handleConfirmSendFailure:
  |             exact match  -> executeOfflineSend -> sendComplete (offlineFallback)
  |             non-exact + suggestion -> chooseProofs
  |             else -> error MINT_UNREACHABLE / SEND_FAILED
  |        NEVER calls online executeSend
  |
  +-- else --> Path C online
           executeSend
           failure -> handleConfirmSendFailure (same offline fallback / chooseProofs)
```

### Mint-unreachable classification

`isMintOfflineError` (`src/errors.ts:8-13`) is the SOLE classifier turning a
failure into "Mint unreachable". It returns true for `NetworkError`,
`HttpResponseError` with status >= 500, or any `Error` whose
`name === 'MintFetchError'`. `createOfflineSendError` and
`createOfflineMintQuoteError` both set `error.name = 'MintFetchError'`
(`effects.ts:395-405`) so the synthetic forced-offline error classifies as
mint-unreachable and resolves to `t('MINT_UNREACHABLE')` ("Mint unreachable").
`executeOfflineSend`'s own `needsSwap` rejection throws a PLAIN `Error` (not a
`MintFetchError`), so it surfaces as `SEND_FAILED`, not `MINT_UNREACHABLE`.

### OPERATION-CONTRACT INVARIANT (the reason this doc exists)

`operations.executeOfflineSend` for an exactly-composable amount MUST complete
WITHOUT contacting the mint. The Colada default delegates to
`mgr.ops.send.prepare` (`defaultOperations.ts:382-406`) and only inspects
`prepared.needsSwap`; it never itself requires the network for an exact match.

Worked example (the recent offline-send break): an exact-match offline send only
stays mint-free if the underlying wallet I/O builds the send from CACHED keysets.
If the app's `mgr.ops.send.prepare` refreshes mint keysets on a stale cache and
does NOT fall back to cached keysets when that refresh fails, the refresh throws
a `MintFetchError`. Colada classifies any `MintFetchError` as mint-unreachable
(`errors.ts:11`) and cannot distinguish "needed the network" from "refused to use
the cache", so the exact-match offline send regresses to "Mint unreachable" /
"Could not connect to mint" even though no mint contact was logically required.

The fix must live in the `executeOfflineSend` operation / Coco manager, not in
Colada. The general classifier behavior is grounded in `errors.ts`; the specific
keyset-cache TTL and cache-fallback behavior live in `@cashu/coco-core`, outside
this package, which is precisely why this contract is written down here. This is
why changing a flow requires updating this doc and its invariant in the same
change: the only durable guard against this class of regression is the named
contract.

MUST / MUST NOT:

- `runMintQuoteEffect` must short-circuit when `getOffline()` is true and reject
  before calling `executeMintQuote`. `effects.ts:852-856`.
- `mintUnreachableConfirmed` must not be set when `forceLocalSend` or
  `shouldCreateLocalTokenFirst` is true. `effects.ts:717-732`.
- `createOfflineSendError` / `createOfflineMintQuoteError` must keep
  `name === 'MintFetchError'`. `effects.ts:395-405`.
- `transition()` must stamp `offline` onto every `result.context` (when the
  provider value is non-null) so fresh contexts see the real-time value.
  `transitions.ts:384-387`.
- Melt and payment-request flows must have no offline branch; they always attempt
  the mint. Send-token Cancel must short-circuit offline with
  `onSendCancelFailed {offline:true}`. `defaultHandlers.ts:155-163`.

The en copy for `MINT_UNREACHABLE` is "Mint unreachable" (`locales.ts:29`); for
`SEND_FAILED` it is "Failed to create token"; for `MINT_QUOTE_FAILED` it is
"Failed to create mint quote".

## 8. Context resolution and mint selection

`FlowContext` accumulates: `parsed`, `intent`, `amount`, `mintUrl`,
`destination`, `mintQuoteMethod`, `meltQuoteMethod`, `unit` (required),
`paymentRequest`, `meltTarget`, `recipientPubkey`, `recipientProfile`,
`amountEntryDisplay`, `localProofSend`, `memo`, `sendMemoHandled`,
`mintUnreachableConfirmed`, `supportedMintUrls`, `offline`, `reviewToken`,
`rawInput`, `source`, `originalOptions`, `failedOptionValues`
(`types.ts:215-287`).

### Root-entry context clearing

| Event | Context behavior |
| --- | --- |
| `EXECUTE` | builds a FRESH ctx; replaces all prior context (no merge) |
| `AMOUNT_ENTERED` with a new `destination` | rebuild from scratch keeping only `unit` + event fields; drops `parsed`/`intent`/`paymentRequest`/`supportedMintUrls`. `transitions.ts:178-194` |
| `MINT_SELECTED` with a new `destination` | rebuild keeping `unit` + event mint/amount/destination + whitelisted prior fields (methods, paymentRequest, meltTarget, recipients, display). `transitions.ts:231-245` |
| `OPTION_CHOSEN` | explicitly clears `destination`/methods/`supportedMintUrls`/`paymentRequest`/`meltTarget` before re-extracting. `transitions.ts:113-123` |
| `REQUEST_MINT_SELECTOR` (no destination) | drops everything but `unit`. `contextResolution.ts:250` |
| `RESET` | `{step:'idle', context:{unit}}`; bumps `flowGeneration`. `transitions.ts:393-394` |

### Amount survival across mint change

- Same-destination `MINT_SELECTED` preserves the amount:
  `amount = event.amount ?? currentCtx.amount`. `transitions.ts:249`.
- `REQUEST_MINT_SELECTOR` carries `ctx.amount` into `selectMint` data unchanged
  when `ctx.destination` is present. `contextResolution.ts:252,283`.
- `OPTION_CHOSEN`'s clear exists specifically because switching payment-request
  -> lightning previously kept stale `supportedMintUrls`/`paymentRequest` that
  tainted mint selection. `transitions.ts:110-112`.

### Mint selection

A mint is valid for the flow only if it is in `trustedMintUrls`, within
`supportedMintUrls` when set, satisfies the method requirement, and (for
non-mintQuote) has balance >= amount (or balance > 0 when amount unset)
(`resolveNext.ts:126-145`). A pre-set valid `mintUrl` skips `selectMint`
entirely; a single full-amount candidate with no current mint is auto-selected.
`AMOUNT_ENTERED` always resets `memo:undefined` and `sendMemoHandled:false` on
both branches. `revalidateMintForAmount` will REDIRECT to `selectMint` rather
than silently switch away from the user's current mint when an intent-less
continuation resolves to a different mint (`contextResolution.ts:192-204`).

## 9. Consolidated invariants checklist

Test coverage is noted where verifiable; "untested" means no test was identified
during verification and the invariant rests on source review.

### Send ecash

- [ ] Online sends never pre-show `chooseProofs` (`resolveNext.ts:166-169`).
- [ ] `checkProofComposition` runs only for `sendEcash` (`resolveNext.ts:161`).
- [ ] Offline send requires exact composition; `needsSwap` cancels + throws
      (`defaultOperations.ts:386-394`).
- [ ] After `PROOFS_CHOSEN`, no re-entry to `resolveFromContext`
      (`transitions.ts:282-329`).
- [ ] offlineFallback only on mint-offline + exact + `executeOfflineSend`
      (`effects.ts:753-763`).
- [ ] `mintUnreachableConfirmed` excluded for `forceLocalSend` /
      `shouldCreateLocalTokenFirst` (`effects.ts:717-732`).
- [ ] Stale-generation short-circuit on every async branch
      (`effects.ts:742,769,790,1196,1233`).
- [ ] Mock-fail send disabled in production (`defaultOperations.ts:341-351`).

### Melt

- [ ] Offline melt impossible; no `chooseProofs` for melt
      (`resolveNext.ts:159-161`).
- [ ] LNURL amount-mismatch guard (`lnurl.ts:268-279`).
- [ ] LNURL https / `.onion` callback lock (`lnurl.ts:115-130`).
- [ ] Cancel-after-failed-execute releases reserved proofs
      (`defaultOperations.ts:761-781`).
- [ ] Success stays on `navigateToMeltPreview` (`createMachine.ts:634`).
- [ ] `MISSING_MELT_TARGET` when meltTarget absent
      (`contextResolution.ts:363-369`).

### Mint quote

- [ ] Offline mint quote rejected before I/O (`effects.ts:852-856`).
- [ ] Onchain unsupported; always prepares `bolt11`
      (`defaultOperations.ts:411-418`).
- [ ] Machine never awaits invoice payment; `onTransactionCreated` is the handoff
      (`effects.ts:434-447`).

### Receive / redeem

- [ ] Untrusted mint routes through `reviewMint` before `executeReceive`
      (`defaultHandlers.ts:224-232`).
- [ ] Non-sat token rejected via `onUnsupportedTokenUnit`
      (`defaultHandlers.ts:212-217`).
- [ ] `MINT_TRUSTED` no-op without `reviewToken` (`transitions.ts:430-439`).
- [ ] Synthetic receive entry omits the encoded token
      (`defaultOperations.ts:714-727`).
- [ ] `linkTransaction` prefers `flowCtx.rawInput` (`defaultHandlers.ts:261-269`).

### Payment request

- [ ] No `chooseProofs` from the normal gate (`resolveNext.ts:158-161`).
- [ ] Rollback returns `rolledBack` only on successful reclaim, else rethrows
      (`defaultOperations.ts:188-216`).
- [ ] `rolledBack` routes through `routeOperationFailure {rolledBack:true}`
      (`createMachine.ts:698-712`).
- [ ] Success stays on `navigateToPaymentRequest` (`createMachine.ts:713-733`).
- [ ] `supportedMintUrls` set only when `info.mints` non-empty
      (`transitions.ts:49,129`).
- [ ] Mock delivery failure disabled in production
      (`defaultOperations.ts:341-351`).

### Offline keystone

- [ ] `appOffline` / `forceLocalSend` 3-way OR (`effects.ts:1181-1182`).
- [ ] `executeOfflineSend` exact-match must not contact the mint (Section 7
      contract; classifier `errors.ts:11`). Untested at the Colada boundary
      because it depends on out-of-package wallet I/O.
- [ ] Synthetic offline errors keep `name:'MintFetchError'`
      (`effects.ts:395-405`).
- [ ] `offline` stamped onto every result context (`transitions.ts:384-387`).

### Context / mint selection

- [ ] Amount survives same-destination mint change (`transitions.ts:249`).
- [ ] Amount survives `REQUEST_MINT_SELECTOR` (`contextResolution.ts:252,283`).
- [ ] Destination change rebuilds context (`transitions.ts:178-194,231-245`).
- [ ] `OPTION_CHOSEN` clears stale intent-specific fields
      (`transitions.ts:113-123`).
- [ ] `RESET` reduces to `{unit}` and bumps generation (`transitions.ts:393-394`).

### Integration boundary

- [ ] Handler resolution order wallet -> default -> built-in copy/share
      (`createManager.ts:162-172`).
- [ ] `execute()` clears loading in `finally` (`createManager.ts:174-194`).
- [ ] `execute()` spreads a fresh ctx; never mutates `getContext()`
      (`createManager.ts:181-189`).
- [ ] Decoration skipped for `amountEntry` and `mintSelector`
      (`session.ts:228-236`).
- [ ] amountEntry next gates on `effectiveSatAmount >= 1`
      (`availability.ts:185-190`).
- [ ] `back` present on every screen surface; `cancel` only where it has a
      distinct operation.

### Mint selection / NFC

- [ ] Auto-pick a single full-amount mint only when no mint is set
      (`resolveNext.ts:445`, `contextResolution.ts:157`).
- [ ] The selector never offers an unaffordable mint as selectable; over-balance
      rows are disabled (`defaultOperations.ts:578-584`).
- [ ] No-valid-mint tries a round-down `chooseProofs` before erroring
      (`resolveNext.ts:489-513`).
- [ ] NFC skips `enterSendMemo` and shows no mint / option / confirm prompt
      (`createMachine.ts:879-998`).
- [ ] NFC rolls back on failure but NOT on stale interruption
      (`effects.ts:1081-1083,1085`).
- [ ] Onchain send/receive stay gated off while `isMethodImplemented('onchain')`
      is false (`availability.ts:318-323`, `resolveNext.ts:284-296`).

## 10. Source map

| File | Responsibility |
| --- | --- |
| `src/machine/createMachine.ts` | `send()` dispatcher, `deriveExecutionState`, step interception (`confirmSend`/`createMintQuote`/`reviewMint`/`openMint`), NFC auto-execute, `routeOperationFailure`, generation guards, bound methods, notify bus |
| `src/machine/transitions.ts` | `transition()`, handlers (`handleExecute`/`handleAmountEntered`/`handleMintSelected`/`handleProofsChosen`/`handleSendMemoSubmitted`/`handleOptionChosen`), offline stamping, context reset/merge |
| `src/machine/resolveNext.ts` | intent-driven routing, `getDestination`, gather order, `checkProofComposition`, `terminalStep`, mint gather, method requirements |
| `src/machine/contextResolution.ts` | `resolveFromContext` (intent-less continuation), `revalidateMintForAmount`, `requestMintSelector` |
| `src/machine/effects.ts` | `runConfirmSendEffect`, `runConfirmMeltEffect`, `runConfirmPaymentRequestEffect`, `runMintQuoteEffect`, `runNfcWriteBackEffect`, `runMintReviewInfoEffect`, `runTrustMintEffect`, `handleConfirmSendFailure`, offline error builders |
| `src/machine/amountFallback.ts` | `buildProofSuggestions`, `buildChooseProofsData`, `buildChooseAmountFallback`, `buildBalanceSuggestions` |
| `src/machine/flows/send.ts` | `startSendEcashFlow`, mint pre-resolution |
| `src/machine/flows/receive.ts` | `startReceiveFlow`, `startReceiveLightningFlow` |
| `src/machine/types.ts` | `FlowStep`, `Destination`, `FlowContext`, `FlowEvent`, `ErrorCode`, `MachineOperations`, `NotificationHandlerMap`, `StepHandlerMap`, `PaymentMachine` |
| `src/operations/defaultOperations.ts` | `createDefaultOperations`: `executeSend`/`executeOfflineSend`/`executeMintQuote`/`executeMelt`/`executePaymentRequest`/`executeReceive`/`buildMintListItems`/`trustMint`/`buildMintReviewInfo`/`resolveRecipientPubkey`/NFC ops |
| `src/errors.ts` | `isMintOfflineError` classifier |
| `src/offline.ts` | `composeSatoshis`, `composeFiat` |
| `src/amount-actions/*` | `AmountActionManager`, `resolveAmount`, QuickSend suggestions |
| `src/screen-actions/*` | `useScreenActions` session, `createManager`, `availability`, `defaultHandlers` |
| `src/lnurl.ts` | LNURL decode, pay params, invoice fetch, amount-mismatch + secure-callback guards |
| `src/intent.ts` | `resolveIntent`, single/multi-option resolution |
| `src/formatting/locales.ts` | error-code-to-copy defaults |
| `src/mint-selection.ts` | mint candidate filtering, `highestBalance` / preferred-mint strategy, `noValidMint` codes |
| `src/annotate.ts` | BIP321 option annotation: `recommended`, disable reasons, prefer-lightning |
| `src/nip05.ts` | NIP-05 `.well-known/nostr.json` recipient pubkey resolution |
| `src/mint-capabilities.ts` | per-mint NUT-4/5 method-unit capability, `isMethodImplemented` |
| `src/chain/onchain.ts` | onchain confirmation helpers, `DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS` |
| `src/history/timeline.ts` | settled-before-confirmed timeline copy |

## 11. Cross-flow expectations and known gaps

This section records intended payment-flow behavior and how the shipped code
currently meets it. Each item tags a status: `shipped` (code already does this),
`partial`, or `gap`. `Current:` describes verified shipped behavior with a source
ref; `Target:` describes the intended contract where it diverges. A `Target:`
line is the named contract a change must move toward -- not a description of
current behavior. Keep these in sync with the per-flow sections above.

### 11.1 Mint offline while the device is online (ecash) -- partial

`ctx.offline` reflects ONLY the device predicate `getOffline()`
(`createMachine.ts:777`); it never reflects mint reachability, and there is no
pre-send mint-reachability probe.

- Current: the offline proof picker (`chooseProofs`) is pre-shown only when
  `ctx.offline === true` (`resolveNext.ts:166-169`). With the device online and
  the mint unreachable, the flow attempts `executeSend`; only on failure does
  `handleConfirmSendFailure` surface `chooseProofs` (non-exact + suggestion) or
  an `offlineFallback` exact send (`effects.ts:753-828`).
- Current: `chooseProofs` carries no reason for why it appeared; its step data
  (`types.ts:120-134`) has no offline / mint-unreachable field and
  `buildChooseProofsData` sets none (`amountFallback.ts:58-78`). The only
  mint-offline copy is post-send: `sendComplete.mintWasOffline` (`types.ts:147`)
  drives the "Mint was offline" warning (`sendTokenWarning.ts:66-94`).
- Target: treat an unreachable mint (online device) like device-offline for the
  picker, and attach a reason so the picker / preview can explain "mint is
  offline". This needs a reachability signal distinct from `ctx.offline` and a
  reason field on `chooseProofs` step data.

### 11.2 Ecash: any send error should fall back to offline -- partial

- Current: the auto `offlineFallback` exact send runs only when
  `isMintOfflineError(cause)` AND an exact local match exists
  (`effects.ts:753-763`). Because the forced-local path synthesizes a
  `MintFetchError` (`createOfflineSendError`, `effects.ts:401-404`), the only
  cause that can reach `handleConfirmSendFailure` as NON-mint-offline is a real
  online `executeSend` failure (`effects.ts:1231-1254`).
- Current: a non-exact failure of ANY cause reaches `chooseProofs` when a
  suggestion exists (`effects.ts:808-828`); but an EXACT-match online failure
  whose cause is not mint-offline falls straight to a hard `SEND_FAILED`
  (`effects.ts:830-836`) -- no offline send is attempted.
- Target: for ecash, any send failure with usable local proofs should attempt
  the local exact send or offer `chooseProofs`, regardless of the cause's
  classification, so a flaky-network swap failure degrades to offline instead of
  erroring.

### 11.3 Payment request when the mint is offline (device online) -- gap

- Current: the payment-request confirm path is offline-blind by type --
  `RunConfirmPaymentRequestEffectConfig` has no `getOffline`
  (`effects.ts:294-299`), unlike the mint-quote and send effect configs
  (`effects.ts:272,282`). `operations.executePaymentRequest` creates the token
  via `mgr.ops.send.prepare`/`execute` (`defaultOperations.ts:938-985`), so an
  unreachable mint fails the send; there is no local-first / round fallback for
  `paymentRequest` (`buildChooseAmountFallback` returns null for it,
  `amountFallback.ts:105`).
- Current: `navigateToPaymentRequest` step data (`types.ts:161-170`) has no
  mint-offline / receive-later field and no locale copy; the confirm screen gets
  no signal to warn.
- Target: allow a payment-request send to a trusted recipient to complete from
  cached keysets when the mint is offline, and -- when the request names no mint
  (accept-any) -- carry a "mint offline, recipient may not redeem until it
  returns" warning into `navigateToPaymentRequest`.

### 11.4 Receiver mints and payment-request availability -- shipped (multi-option) / gap (direct)

- Current: receiver-named mints arrive as `ctx.supportedMintUrls` from the
  request `info.mints`, set only when non-empty (`transitions.ts:49,129`), and
  constrain mint selection (`resolveNext.ts:135`; an empty/undefined set imposes
  no restriction). Select-mint disables out-of-set rows with the inline reason
  "Not accepted by payment request" (`defaultOperations.ts:574`; distinct from
  the locale `NOT_IN_PAYMENT_REQUEST` = "Not in payment request",
  `locales.ts:27`).
- Current: the payment-request OPTION is disabled when no balance-capable
  supported mint exists ONLY for BIP321 multi-option inputs, via `annotateOptions`
  (`annotate.ts:227-260`, called from `intent.ts:74`). A direct single
  payment-request input is never annotated, so a host that offers it as a
  selectable option must derive availability itself.
- Target: surface payment-request availability (disabled when unfulfillable by
  balance + receiver preference) for the direct single-input case too.

### 11.5 Fiat: fee-aware, offline-sendable, silent clamp -- partial

- Current: in fiat mode the resolver auto-optimizes to an exactly-composable sat
  value inside the +/-0.005 fiat window and sets `autoOptimized`
  (`resolve.ts`, `offline.ts composeFiat`). `composeFiat` scans the HIGH end of
  the window first (`offline.ts:313`), so among several in-window exact matches
  it returns the highest, not the fewest-proofs / lowest-fee one.
- Current: the insufficient-funds silent clamp is emergent and works only while
  the affordable maximum lands inside the fiat window (`composeSatoshis` returns
  the total as `nearestLower`, `offline.ts:259-261`). When the whole balance is
  BELOW the window, the no-valid-mint path routes to `chooseProofs` with a
  round-down suggestion if a balance-bearing mint exists (`resolveNext.ts:489-513`),
  else a hard `INSUFFICIENT_BALANCE` / `NO_BALANCE` error.
- Target: prefer the fewest-proofs in-window value for fee minimization, and
  silently send the affordable amount for the "have 999, asked 1000 = same fiat"
  case without a round prompt.

### 11.6 Round dialog scope per destination -- shipped

This matches the intent and is pinned here so it does not regress.
`buildChooseAmountFallback` is the per-destination gate
(`amountFallback.ts:98-131`):

| Destination | Round suggestion offered |
| --- | --- |
| `sendEcash` offline | round up AND round down (exact-proof picker) |
| `meltQuote` online, balance < amount | round DOWN only (`buildBalanceSuggestions`, `roundUp:null` at `amountFallback.ts:53`) |
| `meltQuote` offline | none (returns null, `amountFallback.ts:106`) |
| `paymentRequest`, `mintQuote` | none (returns null, `amountFallback.ts:105`) |

- MUST NOT: lightning (`meltQuote`) must never offer round-UP; the affordable
  suggestion is round-down only (`amountFallback.ts:53`).
- The melt round-down reuses the `chooseProofs` STEP and routes to
  `navigateToMeltPreview` after selection (`resolveNext.ts:499`,
  `transitions.ts:302-315`); melt is NOT free of `chooseProofs`, contrary to a
  happy-path-only reading of Section 5.2.
- The melt round-down target mint is `pickHighestBalanceFallbackMint`
  (`amountFallback.ts:169-186`), which ignores `ctx.mintUrl`/preferred and picks
  the highest-balance allowed mint -- so the suggested amount's mint may differ
  from the user's selected mint.
- Gap: a `paymentRequest` over-balance gets NO round-down (returns null,
  `amountFallback.ts:105`) and hard-errors via `toMintError` (`resolveNext.ts:513`,
  `contextResolution.ts:236`). The intent allows rounding for PR; today it does
  not.

### 11.7 BIP321: try the chosen option, fall back on any failure -- partial

- Current: only `confirmMelt` (`createMachine.ts:637`), `confirmPaymentRequest`
  (`739`), and a `rolledBack` result (`706`) feed `routeOperationFailure`. An
  ecash-send option failure goes through `runConfirmSendEffect`
  (`createMachine.ts:1053-1062`) and an NFC payment-request failure goes straight
  to `error` (`createMachine.ts:979-986`); neither offers a BIP321 fallback.
- Current: `routeOperationFailure` fires `onPaymentFailed` first, then -- when
  `originalOptions.length > 1` -- routes to `chooseFallbackOption`, else stays
  put for single-option retry (`createMachine.ts:451-491`). "Viable" is only
  `status !== 'disabled'` on the re-annotated snapshot (`createMachine.ts:472`);
  balance / mint-support / method are NOT re-evaluated, so an option that became
  unfulfillable since the first choice is still offered and fails again.
- Current: the per-row disabled reason is a hardcoded English
  `{code:'FAILED', message:'Payment failed'}` (`createMachine.ts:468`); only
  `isMintOfflineError` causes localize `lastFailedMessage`
  (`createMachine.ts:447-449`).
- Target: route ANY chosen-option failure (including ecash-send and NFC) to the
  remaining viable options when others exist, and re-apply the live
  balance/support/method filters when computing viability.

### 11.8 Lightning address -> Nostr profile -- partial

- Current: the shipped default derives only a Nostr hex pubkey from a lightning
  address via NIP-05 `.well-known/nostr.json` (`nip05.ts:67`,
  `resolveRecipientPubkey`). There is NO default `resolveRecipientProfile`
  (`defaultOperations.ts:1044-1047`), and stage 2 is hard-gated on it
  (`createMachine.ts:387`), so out of the box only a bare pubkey resolves -- no
  display name / avatar. The host app must inject `resolveRecipientProfile` to
  fill the page.
- Current: the `.well-known/nostr.json` `relays` hint is parsed-but-dropped
  (`nip05.ts:30-36`), and LNURL `lnurlp` `nostrPubkey` is never read
  (`src/lnurl.ts`).
- Target: ship, or document the app's responsibility for, kind-0 profile
  resolution so a scanned lightning address fills the page with Nostr info.

### 11.9 Change mint anywhere; filters propagate -- partial

- Current: `REQUEST_MINT_SELECTOR` is a global event, so the selector opens from
  almost any step (Section 3.6). Mint validity (`trustedMintUrls`, non-empty
  `supportedMintUrls`, method requirement, balance >= amount) is enforced in
  `resolveNext` candidate building (`resolveNext.ts:126-145`) and re-derived in
  `operations.buildMintListItems` row disabling (`defaultOperations.ts`).
  Same-destination `changeMint` preserves `supportedMintUrls` via the context
  spread (`transitions.ts:246-251`); a destination CHANGE drops it
  (`transitions.ts:232-245`).
- Current gap: `requestMintSelector` seeds the candidate list with
  `getValidMintCandidates(walletCtx, {minAmount: amount})` WITHOUT
  `allowedMints: ctx.supportedMintUrls` (`contextResolution.ts:259`), so the seed
  list is not pre-filtered by receiver mints; this is masked only when
  `operations.buildMintListItems` is present (it re-applies the filter). The
  fallback builder `buildFallbackMintListItems` (`createMachine.ts:493-503`, used
  when `buildMintListItems` is absent / enrichment fails / NFC) maps candidates
  1:1 and re-applies NO filter, so under-filtered seeds yield rows with no
  disabled entries.
- Current: the validity predicates are duplicated between `resolveNext.ts`
  (`80-145`) and `contextResolution.ts` (`24-92`); a rule change must be mirrored
  or the gather path and the continuation path disagree.
- Target: pass `allowedMints: ctx.supportedMintUrls` into the seed candidate
  build and have the fallback list builder re-derive disabled status, so every
  selector -- with or without machine operations -- shows invalid mints as
  disabled-with-reason rather than omitted.

### 11.10 Option recommendations -- shipped (emergent)

- Current: `annotateOptions` (`annotate.ts:227-260`) marks one recommended
  option. Payment-request ecash is recommended (`PAYABLE_ECASH`) when a matching
  trusted mint with sufficient balance exists AND lightning is not preferred for
  a hint-less BIP321 input (`paymentRequestShouldPreferLightning`,
  `annotate.ts:114-120`). Lightning becoming recommended on a sender/receiver
  mint mismatch is EMERGENT: a mismatched payment request is disabled (by
  `noTrustedMintInRequest` or `INSUFFICIENT_BALANCE`, `annotate.ts:133-141`) and
  promotion-sort then floats lightning up. There is no explicit
  sender-vs-receiver mint-comparison predicate.
- Target: if a future change leaves a mismatched payment request `available`,
  add an explicit mismatch rule so lightning stays recommended.

### 11.11 Mint auto-advance when the selected mint cannot cover the amount -- partial

- Current: with NO current mint set, the gather path auto-picks the single valid
  full-amount mint (`resolveNext.ts:444-450`) or lands on `selectMint` with
  balance-bearing candidates sorted highest-first (`findFullAmountCandidates`,
  `amountFallback.ts:80-96`). A `preferredMintUrl` in the valid set wins
  (`mint-selection.ts:88-97`).
- Current: when a mint IS already set (e.g. the preferred mint preselected at
  amount entry, `resolveNext.ts:325`) but lacks balance, the machine does NOT
  auto-advance -- the `&& !ctx.mintUrl` guard (`resolveNext.ts:445`; the
  method-required path mirrors it at `contextResolution.ts:157`) sends the user
  to `selectMint`, and the continuation path deliberately redirects rather than
  silently switching off the user's mint (`contextResolution.ts:190-205`).
- Current: when no mint can cover the amount, the no-valid-mint branch first
  tries a round-down `chooseProofs` (`resolveNext.ts:489-513`) and only then
  errors `INSUFFICIENT_BALANCE` / `NO_BALANCE` / `NO_VALID_MINT`
  (`resolveNext.ts:40-51`; `NO_ALLOWED_MINT_TRUSTED` maps to `NO_VALID_MINT`).
  The post-amount selector never offers an unaffordable mint as selectable:
  `operations.buildMintListItems` disables `balance < amount` rows
  (`defaultOperations.ts:578-584`), and the seed candidate lists are pre-filtered
  to `balance >= amount`.
- Target: when the selected mint is empty but another valid mint can cover the
  amount, auto-advance the amount selector to the next-highest-balance valid mint
  (still user-changeable) instead of forcing a selector trip. A future
  fiat-roundable allowance (treat the sat amount as fiat when roundable to the
  same fiat) is also not implemented; mint validity is strict sats
  (`isMintValidForFlow`, `resolveNext.ts:126-145`).

### 11.12 Lightning failure: swap to another mint to fulfil -- gap

- Current: `routeOperationFailure` (`createMachine.ts:440-491`) has two outcomes:
  stay on `navigateToMeltPreview` (single option) or `chooseFallbackOption` /
  `ALL_OPTIONS_DISABLED` across the BIP321 payment METHODS of the same URI.
  `chooseFallbackOption` iterates `originalOptions` (method kinds,
  `types.ts:284-286`), never mint candidates -- it cannot express "pay the same
  invoice from a different mint". `executeMelt` cancels the reservation on the
  failing mint and rethrows (`defaultOperations.ts:774,780`); nothing inspects
  other mints. `MELT_FAILED` is a defined `ErrorCode` (`types.ts:205`) the
  confirm-melt path never emits.
- Target: on a lightning failure, when another trusted mint holds enough balance,
  recommend swapping mints (re-open `selectMint` with the alternates) to pay the
  same invoice -- the receiver does not care which mint pays. The mint-validity
  machinery (`isMintValidForFlow`, `findFullAmountCandidates`) is the reusable
  building block; `navigateToMeltPreview` step data would need a swap-candidate
  field.

### 11.13 NFC: lightning fallback and offline-send range -- gap

Shipped NFC behavior is Section 5.6. The following are intended, not shipped:

- Target: when an ecash NFC send fails and a lightning invoice was carried in the
  tapped BIP321 payload, continue with the lightning flow after the auto
  rollback. Today an NFC failure goes straight to `error`
  (`createMachine.ts:979-986`); there is no auto-open-lightning code path.
- Target: an automatic offline-send range for NFC -- send slightly MORE than
  asked (e.g. a +EUR0.05 merchant tip) from exact local proofs so the tap works
  offline without a prompt. No such range exists today.

### 11.14 Onchain -- gap (mostly future)

- Current: onchain is a recognized capability type (`METHODS = ['bolt11','onchain']`,
  `mint-capabilities.ts`) but is operationally OFF. Onchain RECEIVE forwards to
  `operations.executeMintQuote`, whose default throws on `'onchain'`
  (`defaultOperations.ts:411-413`); onchain SEND errors before any preview
  (`UNSUPPORTED_PAYMENT_METHOD`, `resolveNext.ts:284-296`). The variant menu never
  builds an onchain row because `isMethodImplemented('onchain')` is false
  (`availability.ts:318-323`).
- Current: there is NO onchain amount minimum, no "too small" disable, and no
  enforce-amount / BIP321-wrap of a generated onchain receive amount; the only
  floor is `effectiveSat >= 1` (`availability.ts:190`). There is no
  recommend-payment-request-over-onchain steering.
- Current: confirmation helpers (`chain/onchain.ts`;
  `DEFAULT_ONCHAIN_REQUIRED_CONFIRMATIONS = 6`) and settled-before-confirmed
  timeline logic (`history/timeline.ts`) exist and are exported, but are consumed
  only by the app's receive / history UI; Colada does not poll the chain adapter.
- Target: enforce an onchain receive amount (so it can be wrapped in BIP321 with a
  known amount), disable the onchain amount with a "too small of an amount" reason
  that steers to lightning / payment request, and -- for an onchain send option --
  recommend payment-request first, show required confirmations and an expected
  wait, and reconcile the "settled at the mint before N confirmations" state (mint
  settlement is the source of truth; mempool confirmations are a UI heuristic the
  app history component must explain).

### 11.15 Review mint: trust / don't-trust with auto-melt -- gap

- Current: the `reviewMint` step is entered only by `REVIEW_MINT`
  (`transitions.ts:424-429`) and has exactly two exits: `MINT_TRUSTED` ->
  `trustMint` -> `receiveToken` (`transitions.ts:430-440`,
  `createMachine.ts:1153-1171`), or the app `back`. The `mintInfo` action surface
  is `trust | copy | share | back` (`src/screen-actions/types.ts:54`); there is
  NO don't-trust / reject action and NO `MINT_DISTRUSTED` event.
- Current: the redeem trust gate runs BEFORE `executeReceive`
  (`defaultHandlers.ts:226-233`), so the proofs are NOT yet claimed when
  `reviewMint` is shown -- "don't trust" today is simply not redeeming. There is
  no auto-melt-to-trusted-mint operation, no `reviewMint -> selectMint ->
  executeMelt` routing, and `reviewMint` step data carries no tried/failed-mint
  or error-reason field.
- Target: offer "don't trust" that melts the proofs to a trusted mint chosen via
  the selector, retrying with already-tried mints disabled and their error reason
  shown. NOTE: this presumes the proofs are already claimed, which INVERTS today's
  gate-before-claim ordering -- the target requires claiming into the untrusted
  mint (or moving the review after claim) first.

### 11.16 Change mint at the confirmation screen -- partial

- Current: the change-mint affordance on a lightning / payment-request
  confirmation screen is the GLOBAL `machine.requestMintSelector()`
  (`transitions.ts:390-396`), invoked by the app -- it is NOT a bound screen
  action on those surfaces (`meltQuote` is `pay | cancel | back`,
  `paymentRequest` is `confirm | cancel | back`, `src/screen-actions/types.ts:44-45`;
  the only bound mint-selector action is `receive.changeNpcMint`,
  `defaultHandlers.ts:470-472`). So the "always allow change mint at confirmation"
  philosophy depends on the app surfacing the global call.
- Current footgun: if the selector is opened from the preview and dismissed with
  no mint ever chosen (`flowCtx.mintUrl` absent), a subsequent `CONFIRM_MELT` /
  `CONFIRM_PAYMENT_REQUEST` tap is SILENTLY DROPPED (`createMachine.ts:565-587`,
  `transitions.ts:455-457`) -- no error, no recovery prompt.
- Target: surface a recovery hint instead of silently dropping the confirm tap,
  and (Section 11.13) optionally open the lightning flow after an ecash rollback
  for a QR payload that carried one.
