# Transactions, wallet screens and mints: deepen modules

Surveyed checkout: `/Users/kelbie/Documents/GitHub/Sovran/sovran-surgery`, branch `surgery/pass-3`, HEAD `999c5583ffc6b9baa2db3dadaa17dc31de9cebac`.

Only this survey is written. Product code is read-only. Read the pass-3 brief, codebase-design skill and DEEPENING.md, AGENTS.md, contributor conventions, earlier area surveys and the pass-2 ledger. Dependency direction remains `app → wallet → nostr`; app metadata, routes and stores must not move into `wallet`.

Evidence is source tracing and selective test-body reading, not execution. No tests, knip, builds, native harness, simulator, emulator or funded operations ran. An initial `jg` lookup was started before reading the brief's prohibition; it returned incomplete with HTTP 402 and supplied no source evidence. All subsequent discovery used local file reads and text searches. No web research or deliberate remote inspection was performed. The initial lookup is a procedural exception to the brief's no-network rule.

Paths are repository-relative. In the candidate descriptions, `T`, `W`, and `M` abbreviate `app/features/transactions`, `app/features/wallet`, and `app/features/mint`. Test basenames mean `app/__tests__/` unless otherwise stated. Caller counts count production call sites, excluding re-exports and tests. Line estimates are net production deletions after replacement, not just lines moved, and are approximate; estimates overlap where explicitly noted.

Pass-2 status: swap phase/outcome rules now belong to `app/shared/lib/cashu/swapGroupPhase.ts`. Row and detail both call `swapGroupOutcome`; the old independent row/detail status calculations are no longer a candidate. The ledger also records the newest-keyset-read repair, so the pass-2 keyset defect is not refiled. The remaining chain *presentation* algorithms are distinct from the repaired outcome/replacement rule and must stay so during a mechanical cut.

## Ranked candidates

Ranking weighs obligations removed and net deletion against risk. The first six are the useful clusters; the last five are smaller, directly evidenced interface cuts that can travel with nearby work. Do not create a new framework to realize the estimates.

| Rank | Candidate | Rough net deletion | Size | Mechanical cut? |
| --- | --- | ---: | --- | --- |
| 1 | One transaction filter value and route codec | 90–140 lines | M | Yes, preserve current encodings/defaults |
| 2 | One date-section builder for embedded and bucketed history | 20–35 lines | S | Yes |
| 3 | Resolve swap legs once for totals and rendered rows | 8–15 lines | S | Yes, preserve current totals/fallbacks |
| 4 | One trusted-mint info batch reader for split and plan | 25–40 lines | M | Conditional: preserve request/fallback behavior |
| 5 | Selector rows own live/entry/sticky/cache composition | 15–30 lines | M | Yes, after composition pins |
| 6 | One adjacent-chain grouping implementation | 20–30 lines | M | Yes, keep caller-specific hiding policies |
| 7 | Shrink mint pill to mint data; let BalancePill own geometry | 20–30 lines | S | Yes |
| 8 | Discovery projection owns its metadata snapshot | 15–25 lines | S | Yes, keep row shape/precedence |
| 9 | Remove unused history-unit parameter | 6–10 lines | S | Yes |
| 10 | Home receives a balance node, not a scale callback | 5–10 lines | M | Yes |
| 11 | Mint inspection availability has one input | 5–8 lines | S | Yes |

### 1. One transaction filter value and route codec

**Module and all callers.** `T/components/TransactionsFilterContext.tsx:17-48,58-183`, `T/screens/FiltersScreen.tsx:42-46,93-132,146-199`, `T/screens/TransactionsScreen.tsx:54-116`, and `app/app/(transactions-flow)/transactions.tsx:28-38,83-184`. Context hook: two callers in the same route file, `FilterButton` and `TransactionsRoute`; provider: one transactions-flow layout. FiltersScreen: one route wrapper, `app/app/(filter-flow)/filters.tsx`. TransactionsScreen: one caller, TransactionsRoute. These are the complete production consumers of the filter state/route handoff being cut; `Transactions` additionally receives the renamed primitive filters from TransactionsScreen.

**Caller obligation.** A filter must be added to independent unions, two route schemas, provider setters/value/dependencies, sheet draft/reset/apply, route-to-context synchronization and screen props. Concrete repetitions: context `:80-89` sends `source/lock/counterparty/zap`; sheet `:161-169` manually renames them to `filter*`; route `:144-152` manually sets each field back. Context computes active presence at `:111-124` and then repeats the same eight comparisons for the count at `:126-139`.

**Proposed shape/owner.** The existing transactions filter module becomes owner of an inferred filter value, defaults, count derivation and the two existing route codecs. Provider exposes `{filters, updateFilters, selectedMonth, setSelectedMonth, openFilterSheet}`. Sheet keeps its own draft of that same type. Screen receives a filter value rather than nine individually renamed values. Keep month as viewport state. Keep both route key conventions and their exact validation limits; don't replace navigation payloads with JSON or change defaults. Preserve the current differing treatment of currency in header versus sheet until the defect below is separately repaired.

**Deletion test and estimate.** Removing the current verbose context interface alone would scatter state ownership into its two consumers; the provider earns its keep. Removing repeated representations loses no independent behavior once the value/codec owns it. Delete setter plumbing, parallel type declarations, dependency lists and repeated active checks; add one owner and explicit codecs: about 90–140 net lines down. No new wrapper around the existing setters.

**Risk/pins.** Navigation, display only; no saved data, key, payment or wire change. Route encodings stay byte-for-byte compatible. `filtersScreen.test.tsx:193-245` asserts reset/defaults and exact dismissTo params; it mocks history as empty. Add route→context→sheet→route round trips, partial route updates, malformed input, and header count/currency characterization before cutting. There is no disposable shallow-module test file here; retain the sheet outcome tests and test the codec through its callers. M, fewer than ten files; mechanically preserving behavior is feasible.

### 2. One date-section builder

**Module/all callers.** `T/components/Transactions.tsx:441-499,522-541`. Private `createSections` has three calls at `:475-477` (pending, confirmed, expired); embedded memo at `:524-541` independently repeats its algorithm. Three external list callers: `W/screens/WalletScreen.tsx:264`, `T/screens/TransactionsScreen.tsx:316`, `T/components/CounterpartyTransactions.tsx:79`.

**Obligation.** Both implementations must keep date labels, descending date ordering and `monthKey` calculation aligned. The bucketed path creates date entries at `:445-455`, sorts at `:459-461` and attaches month keys at `:467-472`; embedded repeats those operations at `:526-539`. Embedded combines statuses; home caps each status bucket to one day. Those differences are real and must remain.

**Shape/owner.** Keep the owner inside Transactions: one private `sectionsFor(items, prefix)` produces the complete date groups, then home applies the existing one-day slice and the bucketed mode concatenates the same three buckets. Embedded calls it once on the unified sorted timeline. No new exported utility or strategy port.

**Deletion test/estimate.** Delete the embedded duplicate; date grouping reappears only once, not in three parents. Removing grouping itself would force all parents to reproduce list policy, so retain that depth. Around 20–35 net lines down, S, one file.

**Risk/pins.** Display/order/scroll identity only; no money execution, saved data, keys or wire changes. Keep existing prefixes, date labels, timezone semantics and month keys. `transactionsSwapTimeline.test.tsx:299-399` pins buckets, swap-only months, home cap and embedded combined dates. `transactionsMonths.test.ts` pins month helpers. Add several items on one day with mixed status and multiple days/months; keep component-level pins, no new internal-helper tests required. Mechanical.

### 3. Resolve swap legs once for totals and rows

**Module/all callers.** `T/screens/SwapTransactionScreen.tsx:276-285,312-365,463-506`. One screen caller: `app/app/(transactions-flow)/swap.tsx`. Internally two consumers resolve each leg: totals and expanded card rendering. `CollapsedLegGroup` also consumes the existing leg groups, so preserve its inputs.

**Obligation.** Totals at `:328-333` and rendering at `:464-469` independently retrieve/cast quote-indexed mint and melt entries. Rendering additionally constructs a synthetic melt when history is missing (`:471-496`); totals separately decide whether a fallback leg amount represents sent/spent (`:343-347`). Both need to track the same distinction between actual and display-only evidence.

**Shape/owner.** SwapTransactionScreen's existing private derivation owns resolved leg groups: `{leg, mintEntry, meltEntry, meltEntryForDisplay}`. Build the quote index and resolve once; totals and cards consume those values. Preserve the failed-leg spending rule and the current all-hop totals; synthetic display history must never count as actual history. Remove unused `historyReady` from the returned totals value (it is returned at `:363` but not destructured at `:313`); retain the local readiness calculation that controls fees. Do not introduce a separate public totals hook or touch swapGroupPhase.

**Deletion test/estimate.** A standalone wrapper around totals would only move code and fails the test. A resolved-leg value deletes the second lookup/cast/fallback setup and unused result surface; roughly 8–15 net lines down with compact private mapping (the small saving makes this secondary to the filter/date cuts; its main benefit is removing the repeated evidence interpretation). S, one or two files. Reject the cut if the implementation only relocates the 90-line derivation without deletion.

**Risk/pins.** Money presentation, not spending. No changes to saved/sent values. `swapTransactionTotals.test.tsx` pins loaded totals, synthetic rows/navigation, failed legs with/without mint evidence, pending groups, cancelled groups and multi-hop totals. Its chain fixture explicitly expects 1,570 received across two hops (`:408-447`); preserve that behavior even if a net-transfer interpretation seems better. Add partially loaded mint-only/melt-only history and duplicate quote-id characterization before changing lookup ownership. Existing screen tests survive; no shallow totals test to delete. Mechanical after those pins.

### 4. One trusted-mint info batch reader

**Module/all callers.** Duplicated batch readers: `M/screens/MintDistributionScreen.tsx:79-81,166-188` and `M/screens/MintRebalancePlanScreen.tsx:95-103,126-167`. Each is local to its screen, two callers total. Existing acquisition owner is `M/hooks/useMintManagement.ts` (`getMintInfo`); distribution consumes the map in its cards; plan consumes it in names/cards and passes it into the orchestrator at `:193`.

**Obligation.** Both screens acquire the same trusted-mint list plus getMintInfo, fan out to all mints, fallback to each mint's cached info, reconstruct URL-keyed maps and guard late setState. Distribution `:176-184` indexes settled answers by array position; plan `:132-151` builds URL tuples and unwraps settled answers again. Screens own read lifecycle only because the acquisition module does not return the aggregate they need.

**Shape/owner.** Keep getMintInfo as the acquisition owner; colocate a batch-read hook with useMintManagement returning a full `GetInfoResponse | null` map for the supplied trusted records. Delete both local map states and result-unwrapping loops. This is one internal batch owner, not a port with one adapter. Do not substitute useSwapMintInfo: that hook deliberately returns only name/icon and has progressive, bounded cache-miss behavior; the plan needs full info for routing. Keep this cut separate from manager cache repair F207.

**Deletion test/estimate.** If the new hook vanishes, about 60–70 lines of duplicated loading/cleanup return to two screens; a ~30–40-line owner earns its interface. Net 25–40 down, M (two screens plus owner/tests).

**Risk/pins.** The plan feeds money-moving routing; full response fields, fallback choice, list order, number/timing of requests and cache writes must remain. No changes to mint trust, saved fields, stored payloads or network formats are proposed. The two current guards differ (mount-only versus per-effect cancellation); characterize both first. Unifying the latter behavior is a separate stale-read repair, not a mechanical promise. `mintManagementCache.test.ts`, `mintRebalanceOrchestrator.test.ts`, `mintRebalanceRunLifecycle.test.ts` cover adjacent seams, not this aggregate. Add rendered split/plan pins for partial failure, empty list, replacement and same URL on a new manager. Delete the two local orchestration implementations, retain acquisition tests. Conditional mechanical cut; otherwise defer.

### 5. Selector row composition belongs inside the row reader

**Module/all callers.** `M/screens/MintSelectFlowScreen.tsx:79-92,125-139`; `M/hooks/useStickyMintSelectorItems.ts:59-85`; `M/hooks/useMintRowsWithCache.ts:125-169`. The sticky hook and cache hook each have exactly one production caller, MintSelectFlowScreen. The screen has two route callers: `app/app/(send-flow)/mintSelect.tsx` and `app/app/(receive-flow)/mintSelect.tsx`. Frame logger also reads the intermediate values.

**Obligation.** Screen decides whether live/entry arrays are usable (`:79-82`), calls sticky resolution (`:83`), separately selects live-versus-entry enrichment status (`:89-91`), then hands the result back to cache overlay (`:92`). It reconstructs the source label again at `:130-136`. Those are implementation details of which rows to paint, not selection actions or navigation.

**Shape/owner.** Deepen existing useMintRowsWithCache to take live selector details plus route entry and return `{rows, allCold, status, source}`. Keep sticky resolution as a private implementation, with its existing authoritative-empty behavior; internal logging can consume the same provenance. Delete the screen's staging variables, casts and source reconstruction. No new outer composition hook. Keep refresh-on-focus and payment actions outside: they own different effects.

**Deletion test/estimate.** Deleting sticky/cache behavior would lose continuity and first-frame identity, so do not replace these with direct machine rows. Delete only their externally exposed intermediate choreography. Net 15–30 lines down across fewer than ten files, M. Account for telemetry inputs rather than pretending they have no consumers.

**Risk/pins.** Selection availability and display; no trust, saved/wire or payment behavior changes. Preserve base-owned balances/status and cache-owned audit precedence. `mintSelectorStickyItems.test.ts`, `useMintRowsWithCache.test.ts`, `useMintRowsWithCacheSubscription.test.tsx`, `mintAuditSelector.test.ts`, `mintSelectorFrameLog.test.ts` pin parts. Add screen composition with live→absent, authoritative empty live, ready→failed and entry fallback. Once covered at the combined interface, fold/delete standalone sticky tests if its export/file disappears; keep merge precedence and subscription outcome coverage. Mechanical after combined pins.

### 6. Adjacent-chain grouping has two implementations

**Module/all callers.** `M/components/rebalance/groupSteps.ts:29-84`, one caller `M/screens/MintRebalancePlanScreen.tsx:466`; `T/screens/SwapTransactionScreen.tsx:73-111`, one caller at `:291`. StepGroup also feeds `M/components/rebalance/RebalanceChainCard.tsx`; that is a type consumer, not another grouping call.

**Obligation.** Both walk ordered input, append only to the last matching chain, emit `chain-${id}` keys and keep standalone IDs. Compare groupSteps `:60-81` and groupLegs `:86-106`. The plan hides skipped standalone originals *before* grouping; history removes routes covered by chains *after* grouping (`SwapTransactionScreen:293-309`). These visibility rules are different, not safe candidates for accidental unification.

**Shape/owner.** Existing groupSteps module owns one small generic adjacent-chain grouping function over the shared id/chainId/chainPath fields. Existing plan helper supplies its prefiltered steps; history uses the same grouper then applies its current route hiding. Keep the generic internal to the app feature layer; neither wallet nor nostr imports app types. Prefer one items field over parallel steps/legs group types if that reduces adapters. Don't combine this with pass-2's amount-aware `replacedLater` outcome rule.

**Deletion test/estimate.** Delete history's ~40-line grouper and duplicate group shape; modest generalization/consumer updates add ~15–20 lines. Net 20–30 down, M (roughly four files). If both mapped adapters remain equally long, retain the duplicate instead of adding a layer.

**Risk/pins.** Grouped cards and totals visibility; no saved/wire/key changes. `swapTransactionTotals.test.tsx:408-447` pins history chain suppression; `mintRebalanceRunState.test.ts` imports StepState but does not test grouping. Add noncontiguous same-ID chains, standalone ordering and skipped-original plan rendering. Keep caller-specific tests, retire private-grouper-only tests if introduced during the cut. Mechanical with policies held fixed.

### 7. Mint pill computes geometry already owned by BalancePill

**Module/all callers.** `W/components/MintSelector/useMintSelector.ts:21-54,93-99,114-121,148-158`, one hook caller `W/components/MintSelector/MintSelector.tsx:20,51-53`. Six MintSelector JSX callers: `app/app/(drawer)/(tabs)/index/_layout.tsx:25`; `app/features/send/screens/{AmountSelector.tsx:401,PaymentRequestScreen.tsx:161,LightningSendScreen.tsx:305}`; `app/features/receive/screens/{LightningReceiveScreen.tsx:160,OnchainReceiveScreen.tsx:251}`. These are all JSX production callers found in this checkout.

**Obligation.** Mint hook reads window width and computes button/content geometry; MintSelector forwards only buttonWidth (`:51`), while BalancePill's `useBalancePillDimensions.ts:27-44` independently computes those dimensions again. `dimensions.contentHeight` is unread outside its return; contentWidth is only telemetry. The public `trustedMints?: MintAvailability[]` prop at hook `:28` is never read by hook or component and no JSX caller supplies it.

**Shape/owner.** Mint hook returns mint data/loading only. MintSelector passes `props.width`, height and contentHeight directly to BalancePill, whose existing dimension hook remains the single geometry owner. Delete window subscription, dimension memo/type and geometry-only diagnostics from the mint hook; delete ignored trustedMints prop/import. Do not delete getContentWidthFromButtonWidth: BalancePill still imports it. Do not repair F186's unit balance as part of this mechanical deletion.

**Deletion test/estimate.** Deleting MintSelector entirely would scatter mint identity/liveness/icon rules into six callers; retain it. Deleting its duplicated geometry loses no layout capability. Roughly 20–30 net lines down, S, two files. Exact total depends on retaining useful geometry telemetry at BalancePill.

**Risk/pins.** Screen layout/orientation only, no saved data/keys/wire/payment execution. `mintSelectorTestID.test.tsx` mocks the hook and pins forwarded testID, not geometry. Add default/custom-width pill render pins and rotation coverage through real BalancePill; retain selector/liveness tests. No dedicated shallow geometry test needs preserving. Mechanical.

### 8. Discovery adaptation hides an input that its caller must resubscribe to

**Module/all callers.** `M/screens/MintAddScreen.tsx:89-149,385-403,444-447`, local adaptSearchResult has one caller (`:403`). Related existing mapping owner: `M/lib/mintDiscoveryRows.ts:36-63`; its production caller is `M/hooks/useMintSearch.ts`.

**Obligation.** Adapter reads global metadata with getState at `:114`. Caller must subscribe to the entire map at `:388`, include an otherwise unused dependency at `:447`, and suppress compiler memo handling (`:391-396`). This is a hidden dependency, not evidence that memoization itself is wrong. The adapter independently owns a display shape after mintDiscoveryRows has already mapped the discovery response.

**Shape/owner.** Keep app-local discovery projection in existing mintDiscoveryRows. Move the display projection there as a pure function taking its row and cached metadata explicitly. The screen reads its subscribed snapshot directly when mapping, so the memo dependency is real; delete hidden getState, special memo exemption/explanation and duplicated inline info type where it can derive from the existing row. Keep pseudo/skeleton row variants local and preserve profile fetching at the current call point. Don't change stored discovery payload or its schema.

**Deletion test/estimate.** Deleting projection would make UI reconstruct metadata precedence, so preserve one pure projection; moving it alone is not savings. Hidden-subscription choreography, repeated shape assertions and explanatory workarounds yield about 15–25 net lines down, S (two files). Reject broader DTO redesign if net lines rise.

**Risk/pins.** Identity/audit presentation only; no acquisition, saved/wire/key/payment changes. Preserve audit cache precedence, contact rounding and raw URL fallback. `useMintSearchMapper.test.ts` pins the first mapping, not this second adapter. Add rendered Add Mint pins for a late operator metadata update and a cache-missing audit; test the pure projection's outcomes. No old shallow adapter tests were found to delete. Mechanical.

### 9. The history hook's unit parameter has no caller

**Module/all callers.** `T/hooks/useHistoryWithMelts.ts:14-25`. Eight callers: `T/components/CounterpartyTransactions.tsx:41`; `T/screens/{AiRequestScreen.tsx:103,FiltersScreen.tsx:108,SwapTransactionScreen.tsx:241,TransactionsScreen.tsx:186}`; `W/screens/WalletScreen.tsx:79`; `app/features/send/hooks/useQuickPayPeople.ts:56`; `app/features/settings/design-system/variations/useLiveTransactionCases.ts:57`. Every call has zero or one argument, never a unit.

**Obligation.** The external interface promises unit scoping, but callers perform their actual scope elsewhere, e.g. Transactions calls scopeHistory and FiltersScreen computes its own predicate. Dead second parameter and filtering branch suggest another owner for account selection, although real and test accounts require mint classification too.

**Shape/owner.** Keep `useHistoryWithMelts(pageSize = 100)` as the app mock adapter and remove unit argument/conditional memo filtering. Select history directly from mock/live; retain hasMore/isFetching mock overrides and the result memo. Account scope remains `accountScope.ts` plus transactions selection. Do not delete the adapter: replacing it with useColadaTransactions at eight sites would lose mock isolation and multiply branches.

**Deletion test/estimate.** Removing unused unit capability loses no exercised production behavior. Net 6–10 lines down, S, one file. Page size varies (10, 100 and design-system limit), so it is not constant surface to delete.

**Risk/pins.** Read-only history/mock selection, no saved/wire/payment/key changes. `mockModeIsolation.test.ts:99-107` pins live history restoration; transactions timeline tests pin consumers. Add/retain default and explicit page-size forwarding; no existing second-argument test found. Mechanical.

### 10. Home's balance callback accepts a scale that never varies

**Module/all callers.** `W/home/types.ts:43-54`, `W/home/HomeLayouts.tsx:53-60`, `W/screens/WalletScreen.tsx:227-231,251`. HomeTop has one caller, WalletScreen; renderBalance has one invocation, `renderBalance(1)` at HomeLayouts `:60`.

**Obligation.** WalletScreen implements a callback taking floorScale, multiplying the minimum height, and HomeTop must invoke it with the magic constant 1. The comments describe multiple arrangements, but the source exposes one layout and one scale.

**Shape/owner.** HomeTop accepts `balance: ReactElement` and renders it; WalletScreen supplies the same LayoutShiftProbe/Account node with `minHeight={minBalanceHeight}`. WalletScreen remains owner of the sizing value. Delete callback parameter, multiplication and the obsolete variable-scale contract. Do not redesign HomeActions or payment locking.

**Deletion test/estimate.** Deleting the callback indirection loses no variation or test adapter; deleting HomeTop would lose actual arrangement/chrome, so retain it. Roughly 5–10 net lines down, M only because three files change.

**Risk/pins.** Layout only; no saved/wire/key/payment changes. `walletSurfaceSelectors.test.ts` is source/selector coverage, not a height pin. Add an outcome pin for supplied balance node and unchanged payment locking; look on both platforms before implementing. No callback-focused test was found that needs preserving. Mechanical.

### 11. Inspection visibility is specified twice

**Module/all callers.** `M/screens/MintListScreen.tsx:73-88,161-168,343`, one production caller `M/screens/MintSelectFlowScreen.tsx:201-214`.

**Obligation.** Flow screen supplies `showDetailsButton={!isNpcScope && actions.getInfo.available}` at `:204` and repeats that exact condition to decide whether onInspectMint exists at `:206-213`. List combines them again at `:343`. The callback's presence already represents availability.

**Shape/owner.** Keep optional onInspectMint and delete showDetailsButton from list props/default/destructure and caller. MintSelectFlowScreen remains owner of NPC/action availability, evaluates it once and supplies/omits the callback. Don't infer inspection from selection availability; they are independent actions.

**Deletion test/estimate.** Removing the flag loses no production state: no caller supplies a callback while intentionally hiding it. Net 5–8 lines down, S, two files. This belongs with candidate 5 rather than a new abstraction.

**Risk/pins.** Navigation control visibility only; no routes, payloads, saved data, money or keys change. `mintListScreenRows.test.tsx:194-209` pins inspect/hide but uses the redundant flag in a test-only combination; migrate it to absent callback. Add NPC flow assertion with getInfo available so the real policy is pinned at its owner. Keep those observable tests; delete assertions on the removed flag. Mechanical.

## Defects

Follow-ups were searched before evaluating defects. These are traced, not reproduced in a running app. No follow-up file is written because this task authorizes only the survey.

1. **New: filter result count cannot count test-account history.** `T/screens/FiltersScreen.tsx:201-206,232` compares raw history unit directly with the selected account unit. Path: a wallet with a testnut mint offers TSAT in tabs (`:110-115`); choose TSAT; history entries from that mint have mint unit `sat`; comparison with `tsat` rejects all of them. Applying the filter opens Transactions, whose `scopeHistory` uses `belongsToAccount` (`Transactions.tsx:216-219`; `app/shared/lib/cashu/accountScope.ts:16-18`) and therefore displays the records the count excluded. This is a count/list contradiction, not a request to decide grouping policy. Failing test: seed one sat receive on a mint classified testnut, select TSAT, require apply count 1 and the same visible receive after Apply. No saved/wire changes required. Current filtersScreen tests mock history as empty and cannot catch it.
2. **New: a currency-only history filter has no active-filter badge.** `T/components/TransactionsFilterContext.tsx:111-139` omits currency from both active checks, whereas sheet `FiltersScreen.tsx:187-198` treats non-sat currency as active and exposes Reset. Path: apply USD with all other defaults; route applies `setCurrency` but FilterButton (`app/app/(transactions-flow)/transactions.tsx:48-70`) displays no badge because count=0/presence=false. Failing test: round trip a currency-only USD filter, assert header badge 1 and Reset remains available in sheet. Preserve current behavior during candidate 1, then repair this separately; no saved/wire change. No matching existing follow-up located.
3. **Existing F205, still present:** `Transactions.tsx:235,321-324,398-405` hides swap legs even where no group is injected and does not apply mint/test-account scope to groups. Paths and failing-test fixtures already live in `transactionsSwapTimeline.test.tsx:237-295`; retain the existing id rather than refile. This cut must not silently change that pinned behavior.
4. **Existing F186, still present:** `W/components/MintSelector/useMintSelector.ts:69-73` reads default-unit byMint while displaying the supplied unit. Failing test idea: give one mint distinct sat/usd totals and render a USD pill; require its USD total. Candidate 7 only removes geometry, not this defect or F186's older already-repaired fee item.
5. **Existing F220, outside these cuts:** social read replacement/retry and even-split membership behavior remain in the ledger. Do not turn candidate 4 or 8 into a social lifecycle or saved-weight repair. Existing id and pass-2 survey hold the reproduction ideas; this survey did not rerun those paths.

## Cuts to reject or defer

- Pass-0's proposed shared row/detail swap-total algorithm is stale: the current row displays status and raw step count, not monetary totals. The real remaining repetition is quote resolution within the detail screen, and grouping across plan/detail. Preserve the new shared outcome module.
- Unifying chain presentation suppression with amount-aware replacement in swapGroupPhase would change which transfers/fees the screen displays. This needs product/behavior repair beyond a mechanical deepening cut; F238 and F230 document swap leftovers. Never change stored status values or reconciliation writes in this survey's proposed cuts.
- useIsMintTrusted is not a useless boolean wrapper: it owns synchronous tracker/context fallback plus URL normalization and avoids a first-frame trust flash. Deleting it pushes that policy into MintInfoScreen.
- useSwapMintInfo earns its interface with bounded misses, incremental cache visibility and cancellation. Its two callers (swap detail and AI request detail) should not absorb its worker loop.
- useAppBalance and useWalletPresentationUnit own real mock/live policy. The latter's presentation switch varies through UnitSwitcherPill, and mockModeIsolation explicitly tests payment isolation. Do not delete them merely because their bodies are short.
- useStickyCurrencyTabs' scrollY result is unconsumed by its three screen callers, but deleting just that return field saves little. The hook itself deletes real shared header/scroll/spacer work and should stay. Do not replace it with a general header framework.
- Removing the production-unused MintListScreen isExecuting capability would discard a specifically tested execution guard and may conceal missing flow wiring; leave it for the payments/navigation owner to assess.
- No saved schema, storage key, enum, migration, discovery payload, quote/proof contract or network format change is proposed. Any candidate that requires one stops at that point and leaves this pass.

## Evidence limits and excluded reading

Read the named feature paths selectively, with concentrated inspection of filter handoffs, timeline derivations, swap grouping/totals, selector composition, mint info batches, Add Mint projection and HomeTop's caller. Read relevant test cases/fixtures selectively; test names alone are not proof and none were executed here. Did not exhaustively inspect mint changes/reviews, cache persistence implementations, rebalance routing/fee math/engine internals, transaction animation/detail sections, ambient NFC/native implementation, wallet unit switcher platform variants, charts, account lifecycle/migrations, external Cashu implementations, all ADRs or full test bodies. No native UI observations or claim of upgrade/payment safety. Git status was clean at initial inspection; the only intended new file is this survey.

## Not read
