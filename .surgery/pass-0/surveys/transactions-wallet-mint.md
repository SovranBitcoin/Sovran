# Survey: transactions / wallet / mint (+ mint helpers in shared/lib)

Surveyor area: `app/features/transactions`, `app/features/wallet`, `app/features/mint`,
`app/shared/lib/{getMintCatalog,getDiscoveredMintMetadata,mintTestnutRefresh,offlineReachability,pricelistFeed,currency,number}.ts`,
`app/shared/lib/format/*`, and the hosting routes under `app/app`.
Read only. No tests were run (all "pinned" verdicts come from reading the test files).
Paths below are relative to `/Users/kelbie/Documents/GitHub/Sovran/sovran-app/app` unless they start with `wallet/`.

---

## 1. Boundaries, and 2. whether they are pinned

Legend: **PINNED** = a test asserts what a caller sees. **PARTIAL** = some of it is pinned. **INTERNAL** = only
source-text, testID or heavily mocked tests. **NONE** = no test.

### Routes / screens

| # | Boundary | File | Used by | Pinned |
|---|---|---|---|---|
| R1 | `/(transactions-flow)/transactions`: zod `ParamsSchema` for `filter*` deep-link params, then `TransactionsScreen` | `app/(transactions-flow)/transactions.tsx`, `features/transactions/screens/TransactionsScreen.tsx` | wallet "History", filter sheet round-trip | PARTIAL: `__tests__/transactionsHistoryFilter.test.ts` pins the pure `scopeHistory` / `filterScopedHistory`. The route schema, load-more queueing (`TransactionsScreen.tsx:188-212`) and the Pending sweep (`:150-183`) are NONE |
| R2 | `/(transactions-flow)/swap?groupId=`: `SwapTransactionScreen` (leg grouping, totals, fees) | `app/(transactions-flow)/swap.tsx`, `features/transactions/screens/SwapTransactionScreen.tsx` | swap toast "View", swap rows | NONE (`mintDistributionSelectors.test.ts` only checks testIDs) |
| R3 | `/(transactions-flow)/aiRequest`: `AiRequestScreen` + `openAiSession` | `features/transactions/screens/AiRequestScreen.tsx`, `lib/openAiSession.ts` | AI request rows | PARTIAL: `aiRequestConversation.test.tsx` (preview + open-on-tap), `aiRequestRow.test.tsx`; the screen's totals NONE |
| R4 | `/(filter-flow)/filters`: `FiltersScreen` | `features/transactions/screens/FiltersScreen.tsx` | transactions header | PINNED `filtersScreen.test.tsx` |
| R5 | `(tabs)/index`: `WalletScreen` (home actions, swap gating, ambient NFC) | `features/wallet/screens/WalletScreen.tsx` | tab root | INTERNAL (`walletSurfaceSelectors.test.ts`, `walletSimulatorSelectors.test.ts` are testID checks) |
| R6 | `(mint-flow)/add`: `MintAddScreen` (search + URL validation + batch import) | `features/mint/screens/MintAddScreen.tsx` | settings, mint list, flows | PARTIAL: `mintImport.test.tsx` pins `useMintImport`; validation and the pseudo-mint row are NONE |
| R7 | `(mint-flow)/info`: `MintInfoScreen` (trust/accept actions, detail groups) | `features/mint/screens/MintInfoScreen.tsx` | mint rows, accept flow | PARTIAL: `useMintDetailRead.test.ts`, `useIsMintTrusted.test.tsx`; `mintInfoScreenSource.test.ts` is source-text (INTERNAL) |
| R8 | `(mint-flow)/distribution`: `MintDistributionScreen` (writes `mintDistributionStore`) | `features/mint/screens/MintDistributionScreen.tsx` | wallet "Split" | INTERNAL (selectors only) |
| R9 | `(mint-flow)/rebalancePlan?unit=`: `MintRebalancePlanScreen` + `useMintRebalanceOrchestrator` (**moves money**) | `features/mint/screens/MintRebalancePlanScreen.tsx`, `features/mint/hooks/useMintRebalanceOrchestrator.ts` | distribution screen | PARTIAL: `mintRebalanceOrchestrator.test.ts` runs the real `wallet` engine against a fake manager, **sat only**; the screen itself NONE |
| R10 | `(mint-flow)/reviews` | `features/mint/screens/MintReviewsScreen.tsx` | mint info | PINNED `mintReviewsScreen.test.tsx` |
| R11 | `(mint-flow)/history`, `notifications/mint-changes`: `MintChangesScreen` | `features/mint/screens/MintChangesScreen.tsx`, `lib/mintChanges/*` | notifications tab, mint info | PINNED `mintChangesLoading`, `mintChangesDecode`, `mintChangesPhrases`, `mintChangesGroups`, `mintChangeRow` |
| R12 | `(receive-flow)/mintSelect`, `(send-flow)/mintSelect`: `MintSelectFlowScreen` | `features/mint/screens/MintSelectFlowScreen.tsx` | every payment flow's mint picker | INTERNAL (`mintFlowSelectors.test.ts`); row building PARTIAL via `mintListScreenRows.test.tsx`, `mintSelectorStickyItems.test.ts`, `refreshMintSelectorOnFocus.test.ts` |

### Exported hooks / components used outside the area

| # | Boundary | File | Used by | Pinned |
|---|---|---|---|---|
| H1 | `MintSelector` / `useMintSelector` (per-mint balance pill) | `features/wallet/components/MintSelector/*` | wallet header, AmountSelector, LightningSend, PaymentRequest, LightningReceive, OnchainReceive | INTERNAL (`mintSelectorTestID.test.tsx`); balance/unit NONE |
| H2 | `useActiveUnit` / `resolveActiveUnit` / `selectUnit` (reads/writes `mintStore.activeUnit`, `selectedMint`) | `features/wallet/hooks/useActiveUnit.ts` | receive, FiltersScreen, wallet | PARTIAL: `resolveActiveUnit.test.ts` pins the fallback rule; `selectUnit` mint-follow NONE |
| H3 | `useProfileBalanceSync` -> `profileStore.updateProfileBalance` (**persisted** `cachedBalanceSats`) | `features/wallet/hooks/useProfileBalanceSync.ts`, `useAppBalance.ts` | `app/_layout.tsx:118` | NONE |
| H4 | `useMintKeysetUnits` (coco keyset DB read) | `features/wallet/hooks/useMintKeysetUnits.ts` | useActiveUnit, distribution, rebalance plan | NONE direct (mocked in `walletContextProofAmounts.test.tsx`) |
| H5 | `useAmbientNfcArm` (NFC read loop that auto-pays NUT-18 requests) | `features/wallet/hooks/useAmbientNfcArm.ts` | WalletScreen | NONE |
| H6 | `useWalletMintListRequest` | `features/wallet/hooks/useWalletMintListRequest.ts` | wallet header layout | NONE |
| H7 | `FiatCurrencyPill` / `UnitSwitcherPill` (write `settingsStore.displayCurrency`, active unit) | `features/wallet/components/*Pill/*` | wallet, AmountSelector, ReceiveScreen | PARTIAL: `receiveUnitPicker.test.tsx`, `androidUiRegressions.test.tsx` |
| H8 | `useMintManagement` (module-level `inflightLoad` / `lastLoad` cache, account-scoped reset) | `features/mint/hooks/useMintManagement.ts` | MintSelector, Contacts, SettingsRecovery, mint screens, `shared/hooks/useMintInfo` | NONE (mocked wherever it appears) |
| H9 | `useMintImport` (`addMint(trusted:true)` then `wallet.restore`) | `features/mint/hooks/useMintImport.ts` | MintAddScreen | PINNED `mintImport.test.tsx` |
| H10 | `useDebouncedMintValidation` (`fetchMintInfo` /v1/info) | `features/mint/hooks/useDebouncedMintValidation.ts` | MintAddScreen | NONE |
| H11 | `useHistoryWithMelts` (mock layer over `useColadaTransactions`) | `features/transactions/hooks/useHistoryWithMelts.ts` | 8 screens | PARTIAL `mockModeIsolation.test.ts` |
| H12 | `TransactionsFilterProvider` / `useTransactionsFilter` | `features/transactions/components/TransactionsFilterContext.tsx` | transactions-flow layout | NONE |
| H13 | `Transactions` list (scope -> filter -> swap/AI injection -> buckets -> sections; emits pending-ecash and months) | `features/transactions/components/Transactions.tsx` | WalletScreen, TransactionsScreen, CounterpartyTransactions | PARTIAL: pure scope/filter pinned; swap-group injection, buckets, sections, `visiblePendingEcash` NONE |
| H14 | `transactionIdentitySnapshot` / `useTransactionIdentity` | `features/transactions/lib/transactionIdentity.ts` | detail headers | PINNED `transactionIdentity.test.ts` |
| H15 | presentation/probe/months/header badge/detail rows | `features/transactions/lib/*`, `components/detail/*` | detail screens | PINNED (`transactionPresentation`, `transactionProbe`, `transactionsMonths`, `headerBadge`, `transactionDetailRows`, `transactionDetailProbe`) |
| H16 | `useSwapMintInfo` | `features/transactions/hooks/useSwapMintInfo.ts` | swap screen | PINNED `features/transactions/__tests__/useSwapMintInfo.test.ts` |

### Rebalance module (app side of the `wallet` rebalance engine)

| # | Boundary | File | Pinned |
|---|---|---|---|
| B1 | `createRebalanceWalletPort(manager, unit)`: balances, fees, mint quote, melt, trust | `features/mint/lib/rebalanceWalletPort.ts` | PARTIAL, sat only, through the orchestrator test. Non-sat units NONE (see defect D1) |
| B2 | `createRebalanceStepSink`: writes **persisted** `swapTransactionsStore` legs and `transactionAnnotationStore` `quote:<id>` swap annotations | `features/mint/lib/rebalanceStepSink.ts` | PARTIAL: the orchestrator test mocks both stores and asserts calls (tied to internals) |
| B3 | `rebalanceRunState` helpers | `features/mint/lib/rebalanceRunState.ts` | PINNED `mintRebalanceRunState.test.ts` |
| B4 | `computeRebalancePlan` | `features/mint/components/rebalance/rebalancePlanner.ts` | PARTIAL `rebalancePlanner.test.ts` (fee-reserve cases only; the largest-remainder target split is NONE) |
| B5 | `releaseTrustWindow` | `features/mint/components/rebalance/releaseTrustWindow.ts` | PINNED `releaseTrustWindow.test.ts` |
| B6 | `routing.ts` (`buildSwapGraph`, `pickIntermediaryPath`, local-history edges) + `findRebalanceRouteCandidates` | `features/mint/components/rebalance/routing.ts`, `lib/rebalanceRouteCandidates.ts` | NONE (mocked out in the orchestrator test); `rebalanceRouteAudits.test.ts` covers only `rebalanceRouteAudits.ts` |

### Shared helpers, storage and wire formats

| # | Boundary | File | Pinned |
|---|---|---|---|
| S1 | `getMintCatalog` (cache-first per mint; writes `mintMetadataStore`) | `shared/lib/getMintCatalog.ts` (caller `features/send/providers/Colada.tsx`) | PINNED `getMintCatalog.test.ts` (13 cases) |
| S2 | `getDiscoveredMintMetadata` (nagg `/nostr/mint/discover?mint=`; writes metadata, operator stats, testnut verdicts) | `shared/lib/getDiscoveredMintMetadata.ts` | PARTIAL, indirectly through `getMintCatalog.test.ts` and `useMintDetailRead.test.ts` |
| S3 | `refreshMintTestnutVerdicts` / `needsCheck` / `attachMintTestnutToManager` | `shared/lib/mintTestnutRefresh.ts` | PINNED `mintTestnutStore.test.ts`, `mintTestnutRecheck.test.ts`; attach PARTIAL `cocoProviderRetry.test.tsx` |
| S4 | `resolveOfflineReachability` (nagg `/livez` probe) | `shared/lib/offlineReachability.ts` | PINNED `offlineReachability.test.ts` |
| S5 | `createPricelistFeed` (rates polling and backoff) | `shared/lib/pricelistFeed.ts` | PINNED `pricelistFeed.test.ts`, `pricelistProviderWiring.test.tsx` |
| S6 | `formatAmount` (rates, minor units, BTC/sats preference) | `shared/lib/currency.ts` | PINNED `currencyFormatAmount.test.ts` (4 cases) |
| S7 | `formatRate` / `formatCompact` | `shared/lib/number.ts` | `formatRate` PINNED; `formatCompact` NONE |
| S8 | `formatDisplayValue`, `formatVerifiableValue` | `shared/lib/format/*` | PINNED |
| S9 | Persisted AsyncStorage caches `mint-discover-cache`, `mint-changes-cache` (host-scoped); `mint-reviews-cache` is memory only | `features/mint/data/*.ts` | PINNED `useMintSearchCache.test.ts` (including invalid-payload eviction), `mintChangesLoading.test.ts`, release fixtures E19/E20 |
| S10 | nagg `/nostr/mint/changes` JSON-patch payload decode | `features/mint/lib/mintChanges/decode.ts` | PINNED `mintChangesDecode.test.ts` |

**Counts:** 44 boundaries. PINNED 17, PARTIAL 14, INTERNAL 4, NONE 9 (R2, H3, H4, H5, H6, H8, H10, H12, B6).

---

## 3. Likely surgery targets

1. **`useMintRebalanceOrchestrator` run lifecycle**, `features/mint/hooks/useMintRebalanceOrchestrator.ts:103-114`. The phase is spread over
   `runStatus` ('idle'|'running'|'finished'|'cancelled'), `isRunningRef`, `abortRef`, `runIdRef`, `swapGroupIdRef`,
   `swapLegIdByStepIdRef`, `runPlan` (null = never started), plus the global `useSwapStatusStore.active.state`.
   Each handler checks a different subset (`handleSkip` checks only `runStatus`; `handleRouteThrough` does not reset `abortRef` or bump
   `runId` until `onRerouted`). Pinned: engine outcomes for start, cancel and replaced-manager, sat only.
   Not pinned: retry after cancel (`handleRetry` sets `'finished'` over `'cancelled'`, `:343`, QUIRK), `handleRetryFailed`, `handleSkip`,
   the cross-instance guard (`:268`), the group finalize states, and any non-sat unit.
2. **`StepState`**, `features/mint/components/rebalance/groupSteps.ts` with `rebalanceStepSink.ts:59-79`. A status string plus optional
   `routingDetail`, `routeSuggestion{status,path}`, `errorMessage`, `invoice`, `operationId`. Which ones are valid depends on the status.
   PARTIAL (run-state helpers pinned; the sink mapping is only checked through mocked stores).
3. **`useDebouncedMintValidation`**, `features/mint/hooks/useDebouncedMintValidation.ts:9-31`. `isValid: boolean|null` + `isLoading` +
   `error` + `mintInfo` + `url` + two refs encode idle / debouncing / fetching / valid / invalid. NONE (see D4).
4. **`useMintDetailRead` group state**, `features/mint/hooks/useMintDetailRead.ts:35-45`. `{fetching, failed, settled}` + `stale` -> `groupStatus`.
   PINNED by `useMintDetailRead.test.ts`.
5. **Transactions filter shape is defined three times**: the 10 `useState`s plus two hand-copied predicate lists for
   `hasActiveFilters` / `activeFilterCount` (`TransactionsFilterContext.tsx:58-131`), the route `ParamsSchema`
   (`app/(transactions-flow)/transactions.tsx:28-38`), and the `TransactionsScreen` props (`TransactionsScreen.tsx:64-91`).
   `selectedMonth` is in the `openFilterSheet` deps but is not sent. Context and schema NONE.
6. **`Transactions.tsx` (999 lines)**. Account/mint scope, leg hiding, swap/AI injection, bucketing, two copies of the date-section
   grouping (`createSections` at `:451-480` vs `embeddedSections` at `:527-544`), viewability and settle timers. Pure scope/filter PINNED.
   Swap injection, buckets and sections NONE (see D3).
7. **Mock-mode pass-through adapters**: `useAppBalance.ts`, `useHistoryWithMelts.ts` (its `unit` parameter is passed by no caller:
   dead interface), `useWalletPresentationUnit.ts`, plus `mockMode ?` branches inside `useMintSelector.ts:69-73`,
   `Transactions.tsx:319`, `SwapTransactionScreen.tsx:219`. PARTIAL (`mockModeIsolation.test.ts`).
8. **Two sources of the trusted-mint list.** `useMintManagement` (module-level `inflightLoad`/`lastLoad`, `useMintManagement.ts:17-24`)
   runs in parallel with coco-react's `useMints()` (used by `useActiveUnit`, `useMintKeysetUnits`, the rebalance plan).
   The shared `inflightLoad` is not keyed by manager (`:43`): a consumer for a new manager can join an old manager's promise
   and record it as `lastLoad` for the new one. UNVERIFIED whether the account-scoped reset always runs first. NONE.
9. **Three ways to read a per-mint balance**: `balances.byMint` (default-unit only), `byMintAndUnit[url][unit]`, and
   `getMockMintBalance`. `useMintSelector.ts:69-73` and `rebalanceWalletPort.ts:18-25` use the first one, which is wrong for
   non-sat units (D1, D2). NONE for the selector.
10. **Swap totals and leg grouping in `SwapTransactionScreen.tsx:225-333`** duplicate the reconciliation `SwapTransactionRow` /
    `reconcileSwapLegs.ts` do for the row (F139 already notes the two disagree). NONE (see D5).

---

## 4. Obvious defects

**D1. A Balance split in any unit other than sat reads sat balances and spends sat proofs.** Money. Verified by reading.
`features/mint/lib/rebalanceWalletPort.ts:18-24` calls `manager.wallet.balances.byMint()` with no scope. Coco's
`getBalancesByMint` -> `getSingleBalanceUnit(undefined)` returns `DEFAULT_UNIT` = sat
(`node_modules/@cashu/coco-core/dist/index.js:2707-2714, 2807-2813`). `worstCaseInputFee`/`probeMeltFeeReserve` use
`getWallet(manager, mintUrl, 'sat')` (`:28-36`). `prepareMelt` calls `prepareBolt11MeltQuote(manager, mintUrl, invoice)`, whose
`unit` defaults to `'sat'` (`shared/lib/cashu/cocoOperations.ts:110-127`). Only `createMintReceipt` gets the real `unit`.
- Trigger: the Distribution screen's USD tab (`MintDistributionScreen.tsx:267` passes `unit: selectedCurrency`), then Rebalance.
  `MintRebalancePlanScreen.tsx:93,172` plans from `byMintAndUnit[mint]['usd']`.
- What happens: `wallet/src/rebalance/engine.ts:793` compares a USD-cents amount with the source's **sat** balance. If the source
  holds no sats, every step is "skipped (low balance)" and the run reports complete. If it holds sats, the destination mints
  `usd` paid by a melt of the source's **sat** proofs: sats are converted to USD at the destination and the source's USD is untouched.
- Should: scope the balance to `{ units: [unit] }`, use `getWallet(..., unit)` with unit-filtered proofs, and pass `unit` to `prepareBolt11MeltQuote`.
- Stored data / migration: none. Wire: the melt quote's `unit` field becomes correct. Not pinned: the orchestrator test only mounts `'sat'`.

**D2. The mint pill shows the sat balance under a non-sat unit label.** Display. Verified.
`features/wallet/components/MintSelector/useMintSelector.ts:69-73` reads `liveBalances.byMint[mintUrl]?.total`.
`BalanceProvider` is unscoped, so `byMint` is the sat balance (coco-react `index.js:345`). It then renders `<AmountFormatter amount={balance} unit={unit}>`
(`shared/ui/composed/BalancePill/BalanceDisplay.tsx:157`).
- Trigger: `LightningSendScreen.tsx:308`, `PaymentRequestScreen.tsx:162`, `LightningReceiveScreen.tsx:150/163` or `OnchainReceiveScreen.tsx:233/253`
  with `entry.unit = 'usd'` on a mint that holds 5,000 sat.
- What happens: the pill reads "$50.00" (5,000 taken as cents). Mock mode does use the unit, so the two modes disagree.
- Should: `byMintAndUnit[mintUrl]?.[unit]?.total`. No stored data.

**D3. Swap groups ignore the history screen's mint filter and testnut account.** Verified.
`features/transactions/components/Transactions.tsx:321-324` keeps a swap group when `g.unit === toRealUnit(account.unit)` and nothing else.
Legs carry `fromMintUrl`/`toMintUrl` (`swapTransactionsStore.ts:38-61`).
- Trigger: History, then filter by mint X (`mintUrlFilter=X`); or currency `tsat`.
- What happens: every sat swap, including swaps between mints other than X, still shows in the mint-X list, and real-mint
  swaps show in the testnut account (and the reverse). Their own legs are correctly scoped out by `scopeHistory`.
- Should: apply the same account and mint scope to a group through its legs' mints. No stored data.

**D4. Mint URL validation shows a stale "valid" result for a different URL.** Verified by reading, not run.
`features/mint/hooks/useDebouncedMintValidation.ts:100`: each keystroke keeps the previous `isValid` (`...prev`, only `isLoading` set), and
`MintAddScreen.tsx:408` builds the pseudo-mint row from `isValid === true && customMintInfo` without checking `isLoading`.
- Trigger: type `mint.a.com` (valid), then append `x`.
- What happens: for the 800 ms debounce plus the fetch, the list offers `https://mint.a.comx` as a valid, selectable mint carrying
  mint A's name and icon.
- Second path: an input that fails `new URL()` returns at `:43-49` **before** the abort at `:51`. A slower in-flight fetch for the
  previous URL then lands and sets `isValid: true`/`mintInfo` while the field holds the invalid text.
- Impact: a wrong row. Adding it fails at coco's `addMint`, so no money is at risk.
- Should: clear `isValid`/`mintInfo` on input change and abort before the format check. No stored data.

**D5. Swap detail overstates "Fees" when a leg failed before paying.** Wrong total. Verified.
`SwapTransactionScreen.tsx:319` adds `leg.amount` to `sent` for any leg with no melt history entry, whatever its `localStatus`.
The engine opens the leg (and the store records it) before creating the mint receipt (`wallet/src/rebalance/engine.ts:830-866`).
- Trigger: a 2-leg swap. Leg 1 done (melt 1000, mint 990). Leg 2 fails at `createMintReceipt` (destination unreachable), amount 500.
- What happens: received 990, sent 1500, so the footer shows "Fees 510 sat" (`:553-557`).
- Should: count only legs that actually melted. No stored data.

**D6. Mock Mode writes the mock balance into the real profile's saved balance.** Low severity: Mock Mode is behind `devMode`. Verified.
`features/wallet/hooks/useAppBalance.ts:14-18` returns `mockBalance` in mock mode. `useProfileBalanceSync.ts:12-14` writes it with
`updateProfileBalance(activeAccountIndex, ...)` into the persisted `profileStore.cachedBalanceSats`, which the profile switcher shows
(`shared/lib/popup/popups/actionSheets.tsx:42-43`).
- Trigger: Mock Mode on, switch profiles.
- What happens: each visited profile keeps the mock total until it is next active with mock mode off.
- Should: skip the sync in mock mode. The fix touches no stored shape.

Behaviour I would not call a defect without the owner (QUIRK):
- Transaction rows, swap detail and AI rows always convert to USD (`Transaction.tsx:121`, `SwapTransactionScreen.tsx:125,361`,
  `AiRequestScreen.tsx:87,146`, `HistoryEntryHeader.tsx:227`), although `settingsStore.displayCurrency` can be EUR or GBP.
- `WalletScreen.tsx:88-94`'s comment says every payment-starting control is gated during a swap. The ambient NFC auto-pay loop
  (`useAmbientNfcArm`, `:143`) is not gated by `isSwapping`.
- The wallet header `MintSelector` passes no `unit` (`app/(drawer)/(tabs)/index/_layout.tsx:25`), so it always shows sats.

---

## 5. Proposed characterization tests (ranked)

1. **Rebalance wallet port, unit scoping.** New file `__tests__/rebalanceWalletPort.test.ts`, with a fake manager recording the arguments of
   `balances.byMint`, `getWallet` and `quotes.melt.create`.
   - Pin for sat: amounts come from `total`; the mint quote uses the given unit; `trustMint` calls `addMint(url, {trusted:true})`;
     `releaseTrust` is delegated.
   - Add a `test.failing` for `unit='usd'` asserting `byMint({units:['usd']})` and a melt quote in `usd` (QUIRK until D1 is fixed).
   - Broken variant that fails it: drop the `unit` argument from `createMintReceipt`.
2. **Orchestrator run lifecycle.** Extend `__tests__/mintRebalanceOrchestrator.test.ts`.
   - Pin: start, then cancel (`finalizeGroup('cancelled')`, `swapStatus.cancel`, `runStatus 'cancelled'`); `handleSkip` ignored while running;
     `handleRetryFailed` resets only failed steps and never re-runs `settling`/`paymentPending` ones; start refused while
     `useSwapStatusStore.active.state === 'running'`; retry after cancel ends `'finished'` (QUIRK).
   - Broken variant: remove `'paymentPending'` from `isSettled` (`:239`).
3. **Swap detail totals.** New file `__tests__/swapTransactionTotals.test.tsx`, rendering `SwapTransactionScreen` with a seeded swap store and history.
   - Pin: received/sent from history by quote id; the fee row hidden until mint history exists; a chain hides its superseded direct leg;
     a failed leg with no quotes counts toward sent (QUIRK, D5).
   - Broken variant: drop the `chainRoutes` filter.
4. **Transactions timeline.** New file `__tests__/transactionsTimeline.test.tsx`, rendering `Transactions` with entries plus swap groups.
   - Pin: swap legs hidden only when `filter==='all' && type==='all' && !embedded`; swaps always in Confirmed; a list held empty while
     `isFetching` with no rows; `onVisiblePendingEcashChange` emits only cancellable sends; swap groups ignore `mintUrlFilter` (QUIRK, D3).
   - Broken variant: set `groupedRowsShown` to always true.
5. **Mint URL validation.** New file `__tests__/debouncedMintValidation.test.ts`, with fake timers and `fetchMintInfo` mocked.
   - Pin: empty input gives `{null,false,null}`; a bad format gives 'Invalid URL format'; unreachable gives 'Mint not accessible or invalid';
     a newer URL aborts the older fetch; `isValid` carries over during re-validation (QUIRK, D4).
   - Broken variant: remove the `controller.signal.aborted` check.
6. **Mint selector balance.** New file `__tests__/mintSelectorBalance.test.ts` (renderHook with BalanceContext and mints mocked).
   - Pin: the sat balance for unit sat; the mock balance per unit; `isLoading` only with a selected URL, no mint data and mints loading;
     the usd unit currently shows the sat balance (QUIRK, D2).
   - Broken variant: return `isLoading` when no mint is selected.
7. **`useActiveUnit().selectUnit`.** New file `__tests__/activeUnitSelect.test.tsx`.
   - Pin: keeps the preferred mint when it supports the unit; otherwise moves to the highest balance in that unit; never crosses the
     testnut split; never writes `selectedMint` when no mint supports the unit; held funds keep a unit available.
   - Broken variant: drop the `isTestnutMint(...) === isTestnutUnit(next)` filter.
8. **Profile balance sync.** New file `__tests__/profileBalanceSync.test.tsx`.
   - Pin: writes `cachedBalanceSats` for `activeAccountIndex` when the balance or the index changes; in mock mode writes the mock total (QUIRK, D6).
   - Broken variant: write to account index 0.

---

## 6. Not examined

- Read only partly or not at all:
  - Transactions UI: `TimelineCard`, `TimelineRow`, `ExpiryCountdown`, `AccelerateSection`, `ZappedPostSection`, `TransactionLocationSection`,
    `MonthlyChart` internals, `SwipeableRow`, `TransactionSourceSection`.
  - Wallet UI: `PrimaryBalance`, `Account`, `HomeLayouts`, `BitcoinNearYou`, and the `FiatCurrencyPill`/`UnitSwitcherPill` platform variants.
  - Mint screens: `MintListScreen`, `MintCurrencyTabs`, `MintReviewsScreen`, `MintChangesScreen`, `MintSelectFlowScreen`, the body of `MintInfoScreen`.
  - Mint libs: `lib/mintChanges/interpret.ts` and `phrase.ts`, `useMintSearch`, `useMintRowsWithCache`, `useMintPresence`/`useMintLiveness`,
    `mintDiscoveryRows`, `mintDetailsRows`, `auditInfo`.
  - Rebalance: `routing.ts` (graph scoring), `rebalancePlanner.ts` past line 140, `RebalanceStepRow`/`RebalanceChainCard`.
  - AI: `AiRequestScreen` body, `aiRequestPresentation`.
- Persisted stores touched from this area (`mintStore`, `mintDistributionStore`, `swapTransactionsStore`, `transactionAnnotationStore`,
  `profileStore`, `settingsStore`) belong to the stores surveyor; only how this area calls them was checked.
- The `wallet/` rebalance engine was read only where needed to trace D1 and D5.
- No test was run. "Pinned" verdicts come from test names and setup, not from execution.
