# Wallet package: pass 3 survey (deepening modules)

Checkout `sovran-surgery`, branch `surgery/pass-3`. Read-only: no product file written, no git writes, no network, no
`jg`. Evidence is grep counts and file reads, plus two read-only tool runs:

- `knip --include-entry-exports --reporter compact` at the root (the configured `bun run knip` is clean because it
  never checks a package's own entry exports, so the wallet's public surface is unchecked today).
- One throwaway `bun` program against the real `createPaymentMachine` and the test fixtures (written to the session
  scratchpad, run, then deleted) for D1. "Run" below means that program showed it; "traced" means read.

Started from `.surgery/pass-0/surveys/wallet.md` (targets table), `.surgery/pass-2/surveys/wallet.md` (its "pass 3"
items: the unused `sendFlow`/`receiveFlow`, page mode, history strings, lock state, C7, C11) and the ledger's pass 2
conversions 2 (preview phase), 7 (redeem entry), 10 (turn) and 15 (NFC tap), which are left alone except where an
interface is plainly wider than its callers. Known follow-ups are cited, not repeated: F180, F181, F224, F229, F238.

Line numbers are for `wallet/src/...` unless a path says otherwise.

## Ranked candidates

Rank = obligations removed and lines deleted, over risk. Nothing below changes what is stored or sent; where a
candidate comes close to a wire format it says so.

| # | Candidate | Deletes (rough) | Size | Mechanical |
| --- | --- | --- | --- | --- |
| 1 | Barrel exports nobody imports (`index.ts`, `react/index.ts`) | 250 to 350 lines, 135 values, 209 types | M | yes |
| 2 | React and core code with no caller (`useScreenActionsWithConfig`, `usePaymentMachine`, three provider hooks, `createMachineFromInstance`, two dead options) | about 450 lines | M | yes |
| 3 | `ExecutionState` says more than any caller reads | about 170 lines | M | no (test surface moves) |
| 4 | The machine's trust-mint path nobody drives (`mintTrusted`, `MINT_TRUSTED`) | about 110 lines | S-M | yes |
| 5 | `ColadaProvider` flat props that duplicate the instance | about 150 lines | M | yes |
| 6 | Two owners of the wallet context (bound React value vs the tracker) | 18 app arguments, `walletContextRef` | M-L | no |
| 7 | One `advance(event)` for the machine's five `transition` calls | about 50 lines | S | yes |
| 8 | NFC tap: the unit decision and option pick out of `runTurn` | about 100 lines out of `runTurn` | S-M | yes |
| 9 | Host notifications called three ways (with D1) | about 30 lines, one defect | S | no (fixes D1) |
| 10 | Preview step data built in five places | about 60 lines | S-M | nearly |
| 11 | `FlowContext.p2pkLockPubkey`, a mirror every writer must keep | about 40 lines, one rule | M | yes for the mirror |
| 12 | History state rules re-derived outside `filters.ts`/`states.ts` | about 40 lines | S-M | nearly |
| 13 | Unused `sendFlow`/`receiveFlow` definitions | about 95 lines | S | yes |
| 14 | Transactions loader page mode | about 30 lines | S | yes |
| 15 | The two standing-resource hooks (pass 2 C7) | about 100 lines | M | no; waits on F180 |

A section after the candidates answers the question asked about `createMachine.ts` (turn functions, NFC tap,
settled-preview table) directly.

---

### 1. Barrel exports nobody imports

1. **Module.** `index.ts` (672 lines, the `wallet` entry), `react/index.ts` (101 lines, `wallet/react`), and the
   sub-barrels they re-export (`history/index.ts`, `screen-actions/index.ts`, `core/index.ts`, `annotations/index.ts`,
   `copy/index.ts`, `chain/index.ts`, `rebalance/index.ts`, `transport/index.ts`, `units/index.ts`). Callers: the app
   imports `wallet` in 202 places, `wallet/react` in 47, `wallet/amount` 32, `wallet/safeFetch` 12, `wallet/units` 9,
   `wallet/redeemEntry` 6, `wallet/operations` 4 (grep of `from 'wallet…'`). Nothing in `nostr/` imports it.
2. **Obligation.** `knip --include-entry-exports` lists 129 values and 179 types on `index.ts` that no file imports
   through the package, test files included, and 6 values and 30 types on `react/index.ts`. Examples:
   `createScreenActionManager`, `getAvailableActions`, `decorateEntry`, `createDefaultScreenActionHandlers`,
   `resolveNext`, `isLockedSend`, `normalizeP2pkLock`, `createMachineFromInstance`, `createWalletContextTracker`,
   `FlowContext`, `FlowEvent`, `CreateMachineConfig`, `ExecutionState`, `ErrorCode`, the `*_COPY` tables. Each one is
   a name a maintainer has to keep compatible ("Colada is standardized payment UX logic for Coco-based wallets",
   `package.json` description) although the package is `private: true` and has one consumer. The configured
   `bun run knip` does not report them, so the surface only grows.
3. **Proposed shape.** The package entry points export what the app and the package's own tests import, nothing
   else. Internal modules import each other by relative path, as they already do. The `exports` map in
   `package.json` stays as it is (all seven subpaths have app importers).
4. **Deletion test.** Removing an unused re-export loses nothing: no importer, and the implementation stays.
5. **Deletes.** The re-export lines only. Rough count from the knip list: 250 to 350 lines across the barrels. Net
   down; adds nothing.
6. **Risk.** None to money, keys, saved data or wire formats. The only risk is a name the app reaches through a
   string or a `jest.mock` factory; `jest.mock('wallet', …)` factories in `app/__tests__` return objects and would not
   be caught by knip. Grep each name in `app/__tests__` before removing it.
7. **Pins.** `bun run type-check` and `bun run knip` (with entry exports for this workspace) are the gate. Owner
   decision first: whether the package is meant to be published as a library (then this is its public API and stays).
   If yes, write that down and leave it; if no, add `includeEntryExports` for the `wallet` workspace in `knip.json`
   so the ratchet holds.
8. **Size.** M (ten barrel files). Mechanical.

### 2. Code with no caller

1. **Modules and callers.**
   - `react/useScreenActions.ts:163-359` (`buildConfigSession`, `useScreenActionsWithConfig`) and `:70-89`
     (`UseScreenActionsConfig`): no caller in `app/` or `wallet/` (grep; knip agrees).
   - `react/usePaymentMachine.ts` (93 lines): no caller; listed only in the compiler-gate lists
     `wallet/__tests__/unit/react-compiler-mechanisms.test.ts:39` and `app/__tests__/reactCompilerGateCoverage.test.ts:239`.
   - `react/ColadaProvider.tsx:922-924` `useColadaSubscriptions`, `:985-1029` `useSetTransactionAnnotation` and
     `SetTransactionAnnotation`, `:1031-1039` `usePaymentCopy` (with the `paymentCopyOverridesRef` it alone reads,
     `:561`): no caller.
   - `core/createColada.ts:272-329` `createMachineFromInstance` and its config type: called only by
     `__tests__/unit/core-factory.test.ts` (4) and `__tests__/integration/machine-flow.test.ts` (7, live-only). It is a
     second "build a machine from an instance" beside the provider's `buildProviderMachine`
     (`ColadaProvider.tsx:322-416`), and the two disagree: this one ignores `instance.config.getLocale` and
     `getOffline` and pins `getUnit: () => unit`.
   - `useScreenActions(screenType, entry, options)`: `options.amountConfig` (`useScreenActions.ts:615,629,705,727-729,
     754-755`) is passed by none of the 14 app callers (grep `useScreenActions(`).
   - `useReusableMintQuote` returns `refresh` (`useReusableMintQuote.ts:28,198`): none of its three app readers reads it
     (`ReceiveUnifiedTab.tsx:86-155` reads `quote`, `isLoading`; `ReceiveReusableQuoteTab.tsx:123` reads `quote`,
     `error`, `rotate`).
2. **Obligation.** A maintainer changing the session, the provider or the compiler gate keeps these compiling and
   React-Compiler-clean (`useScreenActions.ts:167-176` and `:265-287` carry the same long compiler and StrictMode
   commentary as the live hook beside it).
3. **Proposed shape.** Delete them. Tests that build a machine use `createPaymentMachine` directly (the test harness
   already does, `__tests__/_harness/createTestMachine.ts`); `useScreenActions` loses its third parameter and the
   `providedAmountConfig`/`effectiveAmountConfig` branch, keeping only the derived config.
4. **Deletion test.** Nothing reappears in any caller: there are none.
5. **Deletes.** About 215 (config hook) + 93 (low-level hook) + 60 (three provider hooks) + 75 (factory) + 15 (options)
   ≈ 450 lines, plus the two compiler-gate list entries and the factory's test cases. Net down.
6. **Risk.** None to stored or sent data.
7. **Pins.** `use-screen-actions-hook.test.ts`, `react-compiler-mechanisms.test.ts`, app `reactCompilerGateCoverage`,
   `walletReusableMintQuoteHook.test.tsx`. `core-factory.test.ts` cases that test the factory itself go with it; the
   cases that test `createColada` stay.
8. **Size.** M (six files). Mechanical.

### 3. `ExecutionState` says more than any caller reads

1. **Module.** `machine/createMachine.ts:67-188` (`deriveExecutionState`), `:446-453` (`notify`), `:2464-2478`
   (`processScanData` reads it); `machine/types.ts:527-574` (the three-way union); `react/useExecutionState.ts`;
   `formatting/locales.ts:50-56` (six "ExecutionState messages" in three locales). Callers outside the machine: three.
2. **Obligation.** The machine derives `status`, `code`, `message` (localized) and `isExecutable` for every step on
   every notify. No app code reads any of them:
   - `app/features/mint/screens/MintSelectFlowScreen.tsx:56-60,129,154` reads `execution.step` and `execution.details`;
   - `app/features/send/screens/AmountFlowScreen.tsx:90` reads `isExecuting`;
   - `app/features/receive/screens/ReceiveScreen.tsx:355` reads `machine.inspect().isExecuting`.
   The one internal reader, `processScanData` (`:2466-2477`), asks `status === "needsInput" && code ===
   "OPTION_SELECTION_REQUIRED"`, which is `step === "chooseOption"`. The blocked-code list exists twice
   (`createMachine.ts:149-165` and `types.ts:554-568`) beside `ErrorCode` (`types.ts:373-390`) and collapses three
   codes to `UNSUPPORTED_INPUT` (pass 2 C11), which nobody can see because nobody reads `code`.
3. **Proposed shape.** `inspect()` returns `{ step, isExecuting, details }` (details = the step's data, as
   `MintSelectFlowScreen` already uses it). An error's code and message are in the `error` step's data, typed
   `StepDataMap["error"]`. The machine stays the one owner; the derivation table is deleted, not moved.
4. **Deletion test.** Removing `status`/`code`/`message`/`isExecutable` loses nothing a screen shows; tests lose a
   second way to read the error code they can read from `getStep()` and the step data.
5. **Deletes.** `deriveExecutionState` (~120 lines) to a 5-line projection, ~40 lines of the type, 18 locale strings,
   the duplicated blocked list. Net down ~170.
6. **Risk.** None stored or sent. `ExecutionState` is exported from `wallet` (`index.ts:483`) but no app file imports
   the type (knip).
7. **Pins.** 21 `assertExecution(...)`/`execution: {...}` assertions read `code` (18) or `message` (3), e.g.
   `__tests__/unit/nfc-machine.test.ts:88,183,207,213,220`, `flows/confirm-dead-end.test.ts:153-154`; they move to the
   error step's data. `property/machine-invariants.test.ts` asserts the projection. `wallet/docs/STATE_MACHINE.md:98,
   122-124,175` describes `deriveExecutionState` and needs the same edit.
8. **Size.** M (machine, types, hook, locales, ~15 test files). Not mechanical: the test surface changes shape.

### 4. The machine's trust-mint path nobody drives

1. **Module.** `createMachine.ts:2674,2709` (`mintTrusted`), `:1627-1630` (`reviewMintData`), `:2301-2319` (trust
   effect), `:250,280` (table entries); `machine/transitions.ts:791-813` (`REVIEW_MINT` keeps `reviewToken`,
   `MINT_TRUSTED` consumes it); `machine/effects.ts:505-520,1636-1674` (`runTrustMintEffect`,
   `toTrustMintEffectError`, its config type `:362-367`); `machine/types.ts:501-502,670,1509-1513`;
   `formatting/locales.ts` `TRUST_MINT_FAILED` (×3). Callers of `mintTrusted()` outside tests: zero.
2. **Obligation.** Two owners of "trust the mint of a token being received". The app never sends `MINT_TRUSTED`: the
   `reviewMint` step handler navigates to the mint page (`app/features/send/lib/sovranPaymentConfig.ts:1338-1352`, "The
   token waiting on this review stays on the receive page underneath, which redeems it when Redeem is pressed again"),
   and Trust there is the screen action `mintInfo.trust` → `operations.trustMint` (`screen-actions/defaultHandlers.ts:
   698-723`). The machine path is pinned and documented (`STATE_MACHINE.md:116,171`) but unreachable from the app; any
   change to `REVIEW_MINT` must still keep `reviewToken` for it.
3. **Proposed shape.** `REVIEW_MINT` stays (the receive screen uses `machine.reviewMint`, `defaultHandlers.ts:358`).
   `MINT_TRUSTED`, `mintTrusted()`, `reviewToken`, `runTrustMintEffect` and the `reviewMintData` branch go.
   `operations.trustMint` stays: the screen action owns trust.
4. **Deletion test.** Nothing reappears in the app; the screen action already covers it.
5. **Deletes.** About 110 lines across five source files, plus `INTENT_EVENTS`/`LEAVES_SETTLED_PAYMENT` entries. Net
   down.
6. **Risk.** Trusting a mint is a saved-state write, but it moves to nobody: the screen action is the only writer
   today. No wire format.
7. **Pins.** `flows/receive-token.test.ts` (9 uses), `flows/settled-preview-final.test.ts` (3), `unit/transitions.test.ts`
   (7), `unit/machine-effects.test.ts` (5, `runTrustMintEffect`), `_harness/createTestMachine.ts` (2). Before the cut,
   pin the app path instead: `screen-actions/defaultHandlers.test.ts` for `mintInfo.trust` calling `trustMint` once and
   notifying `onMintTrustedFromScreen`.
8. **Size.** S-M. Mechanical.

### 5. `ColadaProvider` flat props that duplicate the instance

1. **Module.** `react/ColadaProvider.tsx:105-176` (36 props), `:454-520` (destructure, then "Flat props win over values
   carried by the createColada instance"), `:535-553` (`nostrAdapter` operations override), `:567-576` (`getManager`,
   `annotationStore` fallbacks), `:637-660` (translations and logger effects), `:240-290` (`scanSourceFromClipboard`,
   `buildAdapterScanSources`). Callers: one, `app/features/send/providers/Colada.tsx:713-735`.
2. **Obligation.** Each of `getLocale`, `getOffline`, `enableEcashSendMemo`, `getBtcPrice`, `getDisplayCurrency`,
   `getSatsPerUnitMinor` has two sources and a precedence rule (`:514-521`). The app passes all six to `createColada`
   (`Colada.tsx:330-369`) and none to the provider. It also passes `getManager={getManager}` where `getManager = () =>
   manager` (`Colada.tsx:305`), the same manager the instance holds, which `:567-570` would have used. It never passes
   `translations`, `paymentCopyOverrides`, `imagePickerAdapter`, `nostrAdapter` or `loggerAdapter`; it always passes
   `scanSources` (`Colada.tsx:277`), so `adapterScanSources` is never used (`:526-529`), and its clipboard adapter has
   no `readText` anyway (`Colada.tsx:278-283`).
3. **Proposed shape.** `instance` is required and the one source of configuration; the provider keeps only what the
   instance cannot hold (handlers, notifications, actions, bridge, adapters the app passes, deep links, navigation,
   `getUnit`, `detectors`). `buildProviderMachine` loses its no-instance `getContext` branch (`:390-397`).
4. **Deletion test.** Removing the flat getters loses nothing the app sets; the precedence rule disappears.
5. **Deletes.** About 150 lines (props docs, destructure, fallbacks, the nostr override memo, two effects, the adapter
   scan sources, the config log fields). Net down.
6. **Risk.** None stored or sent. `operations={operationsOverride}` stays (the app uses it).
7. **Pins.** app `sovranColadaProviderWiring.test.tsx`, `walletProviderLifecycle.test.tsx`, `paymentDeepLinkRouting`,
   `paymentRouteReentry` (all render the real provider with an instance). Pin first: the machine reads locale, offline
   and price from the instance (one assertion each in the wiring test).
8. **Size.** M (provider, `createColada` types, a few tests). Mechanical once `instance` is required; that is the one
   decision (it is required in practice already).

### 6. Two owners of the wallet context

1. **Module.** `react/ColadaProvider.tsx:188,206,439-441,1066-1100` (`usePaymentFlowMachine({ walletContext })` writes
   `walletContextRef`); `react/useScreenActions.ts:491-502,518-519` (the amount screen's config). Callers: 18 app
   `usePaymentFlowMachine` calls, each first computing `useWalletContext()` (e.g. `app/app/(send-flow)/paymentRequest.tsx:
   31-32`, `app/features/wallet/screens/WalletScreen.tsx:86-87`, `app/features/send/screens/AmountFlowScreen.tsx:86-89`).
2. **Obligation.** With an instance (always, in the app) the machine reads `instance.tracker.getContext`
   (`ColadaProvider.tsx:390-391`) and never `walletContextRef`. The amount screen reads both: `getMethodContext` prefers
   the tracker ("The snapshot the payment machine itself reads, so the menu and the step that follows Next agree",
   `useScreenActions.ts:492-496`), while `getProofAmounts` (`:499-502`) and `getAmountEnvelope` (`:518-519`) read the
   bound React value. So 18 screens compute and bind a value whose only reader is the amount screen's proof list and
   min/max envelope, and those two can disagree with the machine about balances (pass 2 survey, "Unused parallel
   state model").
3. **Proposed shape.** The tracker is the one owner: every amount-screen getter reads
   `walletContextSource.getWalletContext()`; `usePaymentFlowMachine` loses `walletContext` (keeps `unit` and
   `onOptionDismiss`); `setWalletContext`, `walletContextRef` and the 18 `useWalletContext()` calls made only to feed it
   go.
4. **Deletion test.** The bound value has one reader; removing it makes the amount screen agree with the machine.
5. **Deletes.** `walletContextRef`, `setWalletContext`, the binder's context effect, and up to 18 app lines plus their
   imports where `walletContext` has no other use. Net down.
6. **Risk.** What the amount screen allows: the envelope gates Next and the proof list feeds offline suggestions. The
   app's `WalletContextProvider` (`app/shared/providers/WalletContextProvider.tsx:81-…`) applies the testnut split and
   active-unit slicing; the tracker is given `isTestnutMint`/`isTestnutAccount`/`getActiveUnit` (`Colada.tsx:363-366`)
   but whether its `proofAmounts` and `mintBalances` equal the React value for every account was not established.
   Display gating only; nothing stored or sent.
7. **Pins.** `unit/use-screen-actions-hook.test.ts`, `integration/wallet-context.test.ts`, `unit/core-factory.test.ts`,
   app `walletProviderLifecycle`, `inProcessProfileSwitch.test.ts`. Pin first: for a testnut account and a fiat unit,
   the tracker's `proofAmounts`/`mintBalances` equal `useWalletContext()`'s.
8. **Size.** M-L (provider, hook, 18 app files). Not mechanical until the equality is pinned.

### 7. One `advance(event)` for the machine's five `transition` calls

1. **Module.** `machine/transitions.ts:715-727` (`transition(currentStep, currentCtx, event, detectors, walletCtx,
   unit, offline, enableEcashSendMemo, getSatsPerUnitMinor)`). Callers: `createMachine.ts:1646,1825,1916,1948,2018`;
   tests `unit/transitions.test.ts` (7), `flows/execute-routing.test.ts` (1).
2. **Obligation.** Three of the nine arguments (`detectors`, `enableEcashSendMemo`, `getSatsPerUnitMinor`) are machine
   configuration with one value per machine, passed identically at all five sites; `unit` is `getUnit?.() ?? configUnit`
   (7 copies in the file) and `offline` is computed once per turn. The four NFC sites are the same 15 lines each
   (`:1823-1841`, `:1915-1932`, `:1947-1964`, `:2016-2034`): read context, read unit, call `transition` with nine
   arguments, `if ("kind" in r) break`, assign `flowCtx`, stamp `source = "nfc"`, `setStep`. Likewise
   `getLocale?.() ?? "en"` is spelled 9 times and `isStale: (op) => isStaleGeneration(sendGeneration, op)` 10 times.
3. **Proposed shape.** `transition(step, ctx, event, env)` with `env = { detectors, walletCtx, unit, offline,
   enableEcashSendMemo, getSatsPerUnitMinor }`; inside `createPaymentMachine`, `const currentUnit/locale/offline`
   accessors once, a per-turn `const stale = (op) => isStaleGeneration(gen, op)`, and an `advance(event, walletCtx)`
   that applies a result (or reports "unchanged"). The NFC loop's four blocks become `advance({...})` calls.
4. **Deletion test.** The repeated argument lists are pure noise: deleting them loses no behaviour.
5. **Deletes.** About 50 lines in `createMachine.ts`, a few in tests. Net down.
6. **Risk.** None.
7. **Pins.** `unit/transitions.test.ts`, `unit/nfc-machine.test.ts` (20 cases), `property/machine-invariants.test.ts`.
8. **Size.** S. Mechanical. Do it before 8.

### 8. NFC tap: the unit decision and the option pick out of `runTurn`

1. **Module.** `createMachine.ts:1538-1612` (before the transition: parse the tag, refuse locked or amountless
   requests, check the requested unit is funded, switch the unit), `:1791-1817` (choose the best option and remember
   the invoice alternative), `:1777-1785` (the loop's three locals). Caller: `runTurn` only.
2. **Obligation.** `runTurn` (`:1174-2409`, 1,235 lines) holds the NFC refusal rules inline: "locked ecash not
   supported" (`:1548-1553`), "must include an amount" (`:1554-1558`, repeated at `:1976-1984`), the funded-in-unit
   check (`:1559-1574`), and the option preference order (payment request, then Lightning invoice, then anything,
   `:1794-1804`). None of it touches machine state until the switch call; it is untested except through a whole tap.
3. **Proposed shape.** A pure module `machine/nfcTap.ts` with `decideTapUnit(input, { detectors, walletCtx, unit,
   locale }) → { kind: "refuse", error } | { kind: "keep" } | { kind: "switch", unit }` and `pickTapOption(options) →
   { best, invoiceAlternative } | null`. `runTurn` does the async switch and the loop; the `NfcTap` value,
   `endNfcTap`, and the write-back branch stay where they are (see the `createMachine.ts` section for why).
4. **Deletion test.** Inlining them back would bring the rules back into the turn: they earn their keep as pure
   functions with their own tests (in-process, no adapter).
5. **Deletes.** About 100 lines leave `runTurn`; with 7, net down for the file. The module adds about 60.
6. **Risk.** Money moves in the write-back, which does not move. F238 (1) (an older tap writing into a newer tap's
   session, about `:2003`) and F229 (a throw between the unit switch and the loop skips cleanup) live next to it: the
   extracted decision is synchronous and cannot throw between switch and loop, which narrows F229's window but does not
   close F238.
7. **Pins.** `unit/nfc-machine.test.ts`, app `nfcSessionBoundary.test.ts`, `useAmbientNfcArm.test.tsx`. The new pure
   functions get table tests at their interface. F228: nothing NFC has run on a phone.
8. **Size.** S-M. Mechanical.

### 9. Host notifications called three ways

1. **Module.** `createMachine.ts:575-584` (`tell`: catches a throw and a rejection), `:586-627` (`announcePayment`
   with its own `announce` wrapper: catches a throw, not a rejection), and 22 bare `void notifications?.X?.(…)` calls
   that catch neither (`:1143,1273,1576,1719,1733,1742,1744,1752,1912,2053,2077,2161,2218,2376,2524,2535,2539`, and
   the four inside `announcePayment`). `tell` is used four times (`:921,940,1341,1408`).
2. **Obligation.** Each new notification site must choose a wrapper; most choose none. The send and mint-quote
   successes forward `onTransactionCreated` by hand (`:2159-2163`, `:2216-2220`) instead of through `announcePayment`.
   A synchronous throw from any bare call inside the main `try` lands in the safety net (`:2402-2408`) after the new
   step is set and before its handler runs: see D1 (F229 lists the same family).
3. **Proposed shape.** Every host notification goes through `tell(name, call)`; `announcePayment` uses it; the two
   hand loops become `announcePayment(effect.value)`.
4. **Deletion test.** Two of the three wrappers go; one rule stays.
5. **Deletes.** About 30 lines net; fixes D1.
6. **Risk.** None stored or sent. Behaviour change: a throwing notification no longer skips the step handler.
7. **Pins.** `flows/turn-exits.test.ts`, `unit/machine-effects.test.ts`. Pin first (fails today): a throwing
   `onScanResolved` still dispatches the `receiveToken` handler.
8. **Size.** S. Not mechanical (it is the fix).

### 10. Preview step data built in five places

1. **Module.** `navigateToMeltPreview`/`navigateToPaymentRequest` data is spelled at `machine/contextResolution.ts:
   870-881,940-956`, `machine/transitions.ts:622-650`, `machine/resolveNext.ts:428-452` and `createMachine.ts:1235-1259`
   (the restore after a dismissed mint list).
2. **Obligation.** Each site lists `mintUrl, meltTarget|paymentRequest, unit, amount, recipientPubkey,
   recipientProfile, phase: { kind: "preview" }`; pass 2 had to add `phase` at all of them. They already differ: the
   restore drops the recipient fields and is the only one that carries `meltQuote`.
3. **Proposed shape.** `previewStep(ctx, { mintUrl, amount, unit })` in `contextResolution.ts` returns the step and
   data for the context's destination (melt or payment request) or null; the five sites call it; the restore adds the
   matching quote.
4. **Deletion test.** The repetition is the only content; one builder holds the shape.
5. **Deletes.** About 60 lines. Net down.
6. **Risk.** None stored or sent; the restored preview gains the recipient's name and avatar (display only;
   `mirrorRecipientOntoStepData` adds them on the next resolve anyway).
7. **Pins.** `flows/quote-first-melt.test.ts`, `flows/payment-request.test.ts`, `flows/settled-preview-final.test.ts`,
   `unit/transitions.test.ts`.
8. **Size.** S-M. Nearly mechanical (the recipient fields on the restore are the one difference).

### 11. `FlowContext.p2pkLockPubkey`, a mirror every writer must keep

1. **Module.** `machine/types.ts:428-450` ("`p2pkLockPubkey` mirrors `p2pkLock.pubkey` … write BOTH, and only through
   `normalizeP2pkLock`"). Writers: `machine/flows/send.ts:119`, `transitions.ts:497-505,521` (`resolveLockPatch`).
   Readers of the mirror: `contextResolution.ts:56,900,920`, `transitions.ts:404,463,609`, `createMachine.ts:661,679`,
   `amountFallback.ts:169-170,219-223`, `effects.ts:902-903,2144-2145`, `resolveNext.ts:722`, `p2pk/lock.ts:117-119`
   (`isLockedSend` reads either). 12 files.
2. **Obligation.** Every writer must set both fields together (all three do); every reader may read either, and
   `contextResolution.ts:920` and `transitions.ts:609` test the mirror directly instead of `isLockedSend`. `null` from
   the amount screen clears both by hand (`transitions.ts:503-505`).
3. **Proposed shape.** `FlowContext` keeps `p2pkLock` only; readers use `isLockedSend(ctx)` or `ctx.p2pkLock?.pubkey`.
   `p2pkLockPubkey` stays wherever it crosses the seam: the `START_SEND_ECASH` event (Nut Drop callers pass a bare key,
   `app/features/nearPay/hooks/useStartNearbySend.ts:73`, `NearPayScreen.tsx:1875`), step data
   (`types.ts:221,281`, read by `app/features/send/lib/sovranPaymentConfig.ts:1057-1074,1438`) and `executeSend`'s
   request (`types.ts:1038`), each derived from `p2pkLock.pubkey` at the one place it is built. The pass 2 union
   (`none | optional | required`, replacing `lockIsOptional`) is a second, non-mechanical step.
4. **Deletion test.** The mirror holds nothing `p2pkLock` does not; deleting it removes the "write both" rule.
5. **Deletes.** About 40 lines and the rule. Net down.
6. **Risk.** The lock decides whether ecash is locked. The step data and history metadata (`injectSendMetadata`,
   `sovranPaymentConfig.ts:1074`, into annotations) are a saved-data path: their field stays, so nothing stored
   changes. The `lockIsOptional` union is out of scope for a mechanical pass.
7. **Pins.** `flows/ecash-send-p2pk.test.ts`, `flows/send-fallback.test.ts`, `unit/p2pk-lock.test.ts`,
   `unit/transitions.test.ts`; app `useSendLock`, `sendLockReclaimGate`. Pin first: a seeded bare-key send and an
   amount-screen `null` produce the same step data as today.
8. **Size.** M (12 files). Mechanical for the mirror.

### 12. History state rules re-derived outside `filters.ts` and `states.ts`

1. **Module.** Owners: `history/states.ts` (vocabulary, aliases) and `history/filters.ts:43-93` (predicates
   `isMintQuotePaymentObserved`, `isMeltQuotePaid`, `isMeltQuoteReadyToPay`, `isReceiveTokenPending`,
   `isSendTokenComplete`, `isSendTokenCancelled`). Re-derivations: `screen-actions/availability.ts:285` (send paid =
   `finalized || rolledBack`), `:347` (receive pending), `:367` (mint paid = `ISSUED || PAID`), `:385-398` (melt);
   `history/timeline/classify.ts:131-139,163-169`; `history/timeline/flows.ts:59` (`isRolledBack`);
   `operations/defaultOperations.ts:131-135` (`mapMeltOperationState`, used at `:196`). By count of `state ===`
   comparisons: `filters.ts` 20, `timeline/flows.ts` 10, `availability.ts` 9, `classify.ts` 9, `defaultOperations.ts` 5,
   `defaultHandlers.ts` 2, `receiveOperations.ts` 2 (the 8 in `legacy-ecash/claim.ts` and 5 in `rebalance/engine.ts` are
   other vocabularies and stay).
2. **Obligation.** "rolled back" is spelled as the pair `"rolledBack" || "rolled_back"` four times outside
   `isSendTokenCancelled`; `availability.ts:367` and `filters.ts:43-55` answer "is this mint quote paid" differently
   (the predicate also accepts `executing`/`finalized` and `remoteState`); `mapMeltOperationState` returns the same as
   `normalizeTimelineMeltState` (`states.ts:142-151`) for every Coco operation state.
3. **Proposed shape.** Mechanical first step: `availability.ts`, `classify.ts` and `timeline/flows.ts` call the
   `filters.ts` predicates (one `isRolledBackState(state)` there for the pair); `mapMeltOperationState` is deleted for
   `normalizeTimelineMeltState`. The pass 2 recommendation (typed per-flow unions decoded once by
   `normalizeHistoryEntry`, predicates as exhaustive switches) stays the larger follow-on and is L.
4. **Deletion test.** The inline copies add nothing the predicates lack, except where they disagree (mint quote), which
   is the drift this is meant to stop.
5. **Deletes.** About 40 lines. Net down.
6. **Risk.** Not stored by this package (Coco owns rows); the JSON entries crossing route params keep their strings.
   One behaviour change if `availability.ts:367` adopts `isMintQuotePaymentObserved`: an entry whose `remoteState` is
   `PAID` while `state` is `UNPAID` hides Copy and Share. Owner call, or keep that one site as is.
7. **Pins.** `unit/states.test.ts`, `unit/history-filters.test.ts`, `screen-actions/availability.test.ts`, the
   `timeline*` tests, `history-normalize`.
8. **Size.** S-M (five files). Mechanical except the mint-quote site.

### 13. Unused `sendFlow` and `receiveFlow` definitions

1. **Module.** `machine/flows/send.ts:15-31` (`SendFlowState`, `SendFlowAction`), `:58-67` (`SendFlowDefinition`),
   `:232-254` (`sendFlow`); `machine/flows/receive.ts:15-28,36-44` (state, event, action, definition types),
   `:157-174` (`receiveFlow`). Callers: `__tests__/unit/send-flow.test.ts:63-68`, `unit/receive-flow.test.ts:49-59`.
2. **Obligation.** A second state vocabulary (`'enter-amount' | 'select-mint' | 'blocked'`, `'receive-hub'`, copy keys
   per state) that the machine never runs; a reader of the flow files has to work out which one is real. The machine
   uses only `startSendFlow`, `startSendEcashFlow`, `startReceive*Flow`.
3. **Proposed shape.** Delete the definitions and their types; the `start*` functions stay.
   `SendFlowTransitionResult`/`ReceiveFlowTransitionResult` stay (the starts return them).
4. **Deletion test.** Nothing reappears; only two test cases read them.
5. **Deletes.** About 95 lines and two test cases. Net down.
6. **Risk.** None.
7. **Pins.** The remaining cases of `send-flow.test.ts` and `receive-flow.test.ts` pin the starts.
8. **Size.** S. Mechanical.

### 14. Transactions loader page mode

1. **Module.** `react/useColadaTransactions.ts:28` (`goToPage` in the result type), `:242` (empty result), `:261`
   (`mode`), `:270` (published), `:277` (logged), `:323-339` (the `page` branch of `refresh`), `:352` (`mode =
   "infinite"`), `:366-380` (`goToPage`). Callers: `app/features/transactions/hooks/useHistoryWithMelts.ts:15` spreads
   the result; no file reads `goToPage` (grep).
2. **Obligation.** `refresh` and `loadMore` must keep the two modes consistent; in page mode `loadMore` would append
   page N+1 to page N's window and a refresh would prepend page 0 (pass 2 C10).
3. **Proposed shape.** One mode: infinite. `refresh` always refreshes the head; `goToPage` and `mode` go.
4. **Deletion test.** Unreachable branch; nothing lost.
5. **Deletes.** About 30 lines. Net down.
6. **Risk.** None.
7. **Pins.** `unit/shared-wallet-read-models.test.ts`, app `walletReadModels.test.ts`.
8. **Size.** S. Mechanical. (App side, same hook: `useHistoryWithMelts`'s `unit` parameter, `:14,22-23`, is passed
   by none of its eight callers; out of this area.)

### 15. The two standing-resource hooks (pass 2 C7)

1. **Module.** `react/useReusableMintQuote.ts:104-231` and `react/useStandingPaymentRequest.ts:92-278`. Callers:
   `ReceiveUnifiedTab.tsx:76,80`, `ReceiveReusableQuoteTab.tsx:123`, `ReceiveScreen.tsx:426`, `useNearbyDiscovery.ts:87`.
2. **Obligation.** The same machinery twice: value/`isLoading`/`error`/`generation` state, `mountedRef`, a per-effect
   `cancelled`, an id ref, a peek-seeded initial state, an identity-store subscription that re-resolves unless the
   recorded id is the shown one, a module-scope try/catch for the compiler, and a `rotate` that checks only
   `mountedRef` (so a rotate finishing after the input changed writes the old input's result, pass 2 C7).
3. **Proposed shape.** One `useStandingResource({ key, peek, resolve, rotate, watch })` keyed by the input; results
   carry the key they were started for and are dropped when it no longer matches.
4. **Deletion test.** Each hook keeps only its key, its watch (quote events vs none) and `freshOnMount`.
5. **Deletes.** About 100 lines. Net down.
6. **Risk.** The helpers they call write `mintStore.standingQuotes` (saved): the hooks do not change that, but F180
   (standing-quote work outliving a profile switch) decides the lifecycle these would share. Do this after F180.
7. **Pins.** app `walletReusableMintQuoteHook.test.tsx`, `walletStandingPaymentRequestHook.test.tsx`. Pin first: a
   rotate finishing after an input change is discarded; rotate success clears an earlier error.
8. **Size.** M. Not mechanical.

---

## `createMachine.ts`: what wants to be its own module

`createMachine.ts` is 2,723 lines; `runTurn` (`:1174-2409`) is 1,235 of them. The question was whether the turn
functions, the NFC tap and the settled-preview table want their own modules, only where that removes something
callers or the main function must know.

**Turn functions (`:455-562`).** No module. The five turn variables are already written only by these functions
("Only the functions under 'Turn' below write these five", `:389-390`), so `runTurn` already knows them only through
`beginTurn`/`finishTurn`/`abandonTurn`/`setExecuting`/`beginCommit`/`endCommit` and the confirm holders. Moving them to
`turn.ts` would add an interface of the same size and remove no knowledge: the deletion test says it is not shallow, it
is just local. What does shrink the main function: a per-turn `stale` closure (10 copies of `isStale: (op) =>
isStaleGeneration(sendGeneration, op)`) and `commit(gen, run)` for the four `beginCommit; try { await … } finally {
endCommit }` blocks (`:1355-1366,1417-1428,2040-2060,2127-2141`). Part of candidate 7. F229's "not one tagged value"
stays with that follow-up.

**NFC tap.** Split in two, as candidate 8 says. The pure halves (unit decision, option pick) want a module: they are
rules with no machine state, and `runTurn` stops knowing them. The loop and the write-back do not: they read and write
`step`, `stepData` and `flowCtx`, call `transition`, payability, commit, `setExecuting`, `announcePayment` and
`forgetNfcPayment`, and check staleness after each await. A module for them needs a port with about ten members, as
wide as what it hides, and the loop's ordering (stale checks between awaits) would cross that port. Keep the loop;
shorten it with `advance` (candidate 7). The `NfcTap`/`NfcTapEnd`/`ScanOrigin` types and `endNfcTap` (pass 2
conversion 15) stay.

**Settled-preview table (`:190-207,254-283`, guard `:1198-1213`).** No module. `LEAVES_SETTLED_PAYMENT` is a
`Record<FlowEvent["type"], boolean>`, so a new event cannot be added without deciding it, and the guard is one
predicate call at the top of the turn. Moving it to `transitions.ts` would add an export and remove nothing the turn
knows. Leave it.

**Others found in the file.** `deriveExecutionState` (`:67-188`) is candidate 3 (delete, not move). The
`MINT_TRUSTED` branch (`:2301-2319`) is candidate 4. The preview restore (`:1226-1261`) is candidate 10. The
notification wrappers are candidate 9. Together with 7 and 8 these take about 400 lines out of the file without a new
module boundary beyond `nfcTap.ts`.

---

## Defects

`docs/follow-ups/` was grepped for each symbol named here; F229 already describes D1's family.

**D1. A notification that throws skips the next step's handler (F229, now run).** `createMachine.ts:1719` (bare
`void notifications.onScanResolved(...)`) inside the main `try` (`:1506`), with the safety net at `:2402-2408`. Path:
scan or paste any input; the host's `onScanResolved` throws synchronously (the app's writes the scan-history store and
an annotation, `app/features/send/lib/sovranPaymentConfig.ts:495-536`). **Run** with `WALLETS.default` and a cashu
token input: step `receiveToken`, `isExecuting` false, handler calls `[]` (control without the throw: `["receiveToken"]`).
The token screen never opens and nothing says why. The same holds for every bare call between `setStep` and
`dispatchHandler`, among them `onMissingMintForAmount` (`:1733`), the three mint-change notifications (`:1742-1752`),
`onTransactionCreated` on a send (`:2161`) and the error-code notification (`:2376`). No stored data or wire format.
Test idea: with `notifications.onScanResolved` throwing, `execute(token)` calls the `receiveToken` handler once.
Repair is candidate 9. F229 is cited, not duplicated.

No other defect was established. Two things looked like one and are not claimed: `availability.ts:285` treats only
the spelling `rolledBack` as finished (entries reaching it are normalized, as far as traced), and
`createMachineFromInstance` ignoring the instance's locale and offline getters (test-only, candidate 2).

## Not read

- `operations/defaultOperations.ts` (2,205 lines) beyond the melt helpers at `:115-262`, `:1600-1662` and the send
  lookup: its width (`Partial<MachineOperations>`, every machine site guarded by `operations?.X`) is a possible
  candidate (an option bag whose only partial adapters are the tests), not assessed.
- `operations/receiveOperations.ts`, `rebalance/engine.ts`, `legacy-ecash/*`, `transport/*`, `chain/*`, `lnurl.ts`,
  `offline.ts`, `mint-capabilities.ts`, `annotations/model.ts`, `amount-actions/*` beyond grep hits.
- `machine/resolveNext.ts`, `contextResolution.ts`, `amountFallback.ts`, `effects.ts` beyond the sites cited.
- `screen-actions/defaultHandlers.ts`, `createManager.ts`, `session.ts` beyond the trust handler and the receive
  redeem branch.
- `react/useColadaBalance.ts`, `sharedReadStore.ts`, `unitPins.ts`, `useColadaTransactionAnnotation.ts`.
- Whether Coco's melt `execute` can resolve with `rolled_back` (which `mapMeltOperationState` turns into `UNPAID`):
  not checked in Coco.
- No test suite was run; no knip run other than the one above; nothing on a device.
