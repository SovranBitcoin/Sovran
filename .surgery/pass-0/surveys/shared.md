# Survey: shared non-feature code (pass 0, "pin behaviour")

Area: `app/shared/hooks`, `app/shared/blocks`, `app/shared/ui`, `app/shared/config`, and the listed parts of
`app/shared/lib` (`apiClient.ts`, `http/`, `errors/`, `logger*.ts`, `debug/`, `image*.ts`, `date.ts`, `id.ts`,
`strings.ts`, `groupBy.ts`, `utils.tsx`, `interactions.ts`, `popup/`, `picker/`, `cta/`, `read/`, `map/`, `motion/`,
`third-party/`, `protocolIds.ts`, `sensitiveFieldNames.ts`, `constants.ts`).

All paths are relative to `/Users/kelbie/Documents/GitHub/Sovran/sovran-app/app` unless they start with `wallet/`.
Tests are in `__tests__/`. Method: read the logic-bearing files end to end; matched every module to the test files
that import it (by import path); read the test titles for the high-risk ones. No tests were run.

"Pinned" below means a test drives the real module and asserts something a caller observes. "Mock-only" means the
tests that mention the module replace it with a mock, so they pin its callers, not it.

---

## 1 + 2. Boundaries, and whether each is pinned

### Payments, money and saved transaction facts

| # | Boundary | File | Used by | Pinned? |
|---|---|---|---|---|
| 1 | `usePaymentStatusListener()`: nine Coco event handlers (`mint-quote:updated`, `mint-op:pending`, `mint-op:finalized`, `receive-op:finalized` x2, `history:updated`, `send:finalized`, `melt-op:rolled-back`, `melt-op:finalized`) that drive every payment toast, write `transactionAnnotationStore` (`quote:<id>` onchain melt facts, `op:<id>` payment-request linkage) and rotate standing quotes in `mintStore.standingQuotes` | `shared/hooks/usePaymentStatusListener.ts` (918 lines) | `app/_layout.tsx` only | **NONE.** No test imports it. `paymentToastGating.test.ts` and `paymentStatusToastSelectors.test.tsx` cover `sovranPaymentConfig` and the toast component, not this hook. |
| 2 | `paymentStatusPopup`, `swapStatusPopup`, `isSwapStatusToastMounted` | `shared/lib/popup/popups/payment.ts` | listener above, payment config, swap orchestrator | `swapStatusPopup` pinned by `swapStatusPopupLifecycle.test.ts`. `paymentStatusPopup` (its `onHide` clears `paymentStatusStore` by id) is mock-only. |
| 3 | `useSwapStatusListener()` (re-pops the swap toast on running to terminal) | `shared/hooks/useSwapStatusListener.ts` | `app/_layout.tsx` | **NONE** directly (`swapStatusPopupLifecycle.test.ts` covers the popup half, not the store subscription). |
| 4 | `useSwapLegReconciler()` | `shared/hooks/useSwapLegReconciler.ts` | `app/_layout.tsx` | **NONE** for the hook (which events trigger a run, stop on unmount). The reconciler itself is another area. |
| 5 | `useOnchainMeltQuote()`: polls `manager.quotes.melt.refresh`, writes outpoint / destination / settled-off-chain annotations | `shared/hooks/useOnchainMeltQuote.ts` | `features/send/screens/OnchainSendScreen.tsx` | Pinned: `useOnchainMeltQuote.test.tsx` (cadence, stop on PAID+outpoint, verdict retries, quote A/B isolation, unmount). Not pinned: the three annotation writes and their once-per-quote guards; `entrySettledAtMount` needing one read instead of two; persisted verdict skipping interval polling; stop on expired UNPAID. |
| 6 | `useOnchainMeltOutpointDiscovery()`: polls mempool.space every 70 s, writes a `heuristic` outpoint annotation | `shared/hooks/useOnchainMeltOutpointDiscovery.ts` | `OnchainSendScreen.tsx` | **NONE.** |
| 7 | `useMempoolAcceleration()`: fetches an offer, creates a Lightning invoice the user then pays, polls status, writes `accelerated` annotation | `shared/hooks/useMempoolAcceleration.ts` | `OnchainSendScreen.tsx` | **NONE.** |
| 8 | `useMempoolAddressSummary()` | `shared/hooks/useMempoolAddressSummary.ts` | receive rail screens | Mock-only (`receiveRailPresentation.test.tsx`). |
| 9 | `useMempoolTxConfirmations()` | `shared/hooks/useMempoolTxConfirmations.ts` | onchain detail | Pinned: `useMempoolTxConfirmations.test.tsx`. |
| 10 | `captureAndStoreLocation(txId)`: writes `transactionLocationStore` and an `id:<txId>` annotation | `shared/hooks/useTransactionLocation.ts` | payment config | Mock-only. The double write and the "setting off means nothing stored" rule are unpinned. |
| 11 | `useSingleFlight`, `useKeyedSingleFlight` (the double-tap guard on pay / publish buttons) | `shared/hooks/useSingleFlight.ts` | 20 files | Pinned: `useSingleFlight.test.tsx`. |
| 12 | `guardedRouter` / `useGuardedRouter()` (600 ms same-destination cooldown; `raw` escape) | `shared/hooks/useGuardedRouter.ts` | 110 files | **NONE** for the cooldown itself; 38 tests import it but every one I sampled mocks it. |
| 13 | `mintHistoryEntryExpired`, `getMintHistoryEntryTimeUntilExpiry`, `meltQuoteExpired`, `getMeltQuoteTimeUntilExpiry`, `getTimeUntilUnlock`, `isOutgoingTransaction`, `compose` | `shared/lib/utils.tsx` | 14 files | Partly: `expiryCountdown.test.ts`, `composeProviders.test.tsx`. `mintHistoryEntryExpired` defaults (`expirySec ?? 3600`, `timestampSec ?? 0`) not checked. |

### Network and wire formats

| # | Boundary | File | Used by | Pinned? |
|---|---|---|---|---|
| 14 | `fetchJson` (timeout + caller signal, non-2xx to `ApiHttpError`, schema failure to `ApiParseError` with paths only, abort passthrough, query string never logged) | `shared/lib/apiClient.ts:255` | every helper below | Partly: `apiClientBackendConfig.test.ts`, `pricelistFeed.test.ts:285`. Not pinned: `ApiParseError` carries no raw input; abort reason `caller` vs `timeout`; `describeRoute` dropping the query. |
| 15 | `fetchNostrProfile` / `parseNostrProfileFor` (nagg v2 envelope to `NostrProfileFull`, NIP-01 tie-break, identities handed to `cacheIdentities`) | `apiClient.ts:367-451, 663` | `useNostrProfile`, vertex refresh | Pinned: `apiClientNostrProfile.test.ts`, `useNostrProfile.test.ts`. |
| 16 | `fetchMintInfo` (https-only, `MintInfoSpine` check before the value reaches Coco) | `apiClient.ts:707` | mint add, mint health, recovery | **Mock-only.** `mintHealth.test.ts`, `recoveryDiscovery.test.ts` and others replace it. Neither the `http:` / `file:` rejection nor the non-string `name` rejection has a test. |
| 17 | `discoverMints`, `discoverMint`, `fetchMintInfos`, `fetchMintChanges`, `reviewMint` | `apiClient.ts` | mint discovery, testnut store, reviews | Pinned for URL shape and happy-path parsing: `apiClientBackendConfig.test.ts`, `mintTestnutStore.test.ts`, `mintChangesLoading.test.ts`, `fetchMintReviews.test.ts`. Lenient `.catch(undefined)` fields (`auditSource`, `testnut`, `status`) not checked. |
| 18 | `getLatestVersion`, `fetchBtcRates`, `getAiLineup`, `getAiProviders`, `fetchWallpaperCatalog` | `apiClient.ts` | CTA, price feed, AI tab, wallpapers | Pinned through callers with `fetch` stubbed: `ctaLatestVersionFetch.test.ts`, `pricelistFeed.test.ts`, `routstrLineupRefresh.test.ts`, `wallpaperBtcMap.test.ts`. |
| 19 | `parseBackendConfig` / `backendConfig` (env overrides, precedence, trailing slash) | `shared/config/backend.ts` | 7 files | Pinned: `backendConfig.test.ts`. |
| 20 | `buildAbortSignal`, `DEFAULT_TIMEOUT_MS` | `shared/lib/http/requestSignal.ts` | routstr, apiClient | Indirect only (11 tests import the constant). |
| 21 | `createStreamCapableResponse`, `installStreamCapableResponse` (keeps a streamed AI answer the user paid for) | `shared/lib/http/streamResponse.ts` | `shim.js` | Pinned: `streamResponse.test.ts`. |

### Errors and logging

| # | Boundary | File | Used by | Pinned? |
|---|---|---|---|---|
| 22 | `describeError(error, service)`, `describeWalletFailure` | `shared/lib/errors/index.ts` | 24 files | Pinned: `serviceErrors.test.ts` (15 cases), `serviceErrorPopup.test.ts`. Not pinned: the `status === 0` to network fallback (`index.ts:196`); `describeWalletFailure` with `authored: true`. |
| 23 | `ERROR_COPY`, `CASHU_CODES`, `CASHU_MESSAGE_RULES` | `shared/lib/errors/catalog.ts` | 16 files | Partly: a handful of codes and rules are exercised; the table as a whole is not snapshotted. |
| 24 | `inspectError` (bounded traversal, 16 nodes, 2048-char cap) | `shared/lib/errors/inspect.ts` | `describeError` only | Pinned through `serviceErrors.test.ts` (cycles, throwing accessors). |
| 25 | Logger redaction: `secretStringKind`, `redactKnownSecretSubstrings`, `redactError`, field-name redaction, `createLogger` | `shared/lib/loggerCore.ts:284-590, 800-860, 1241` | every module | Pinned well: `loggerRedaction.test.ts`, `loggerChild.test.ts`, `secretPatternsSingleOwner.test.ts`, `sdkLogger.test.ts`. Gap: an `Error` nested below the top level (see defect D2). |
| 26 | `sensitiveFieldKind` | `shared/lib/sensitiveFieldNames.ts` | logger, storage dump | Pinned: `sensitiveFieldNames.test.ts`. |
| 27 | `redactStorageDump` and the storage inventory ("Share Full Dump") | `shared/lib/debug/storageInventory.ts` | settings debug screen | Pinned: `redactStorageDump.test.ts`, `storageInventoryBackups.test.ts`. |
| 28 | Log file: `applyFileLogging`, `getLogFileInfo`, `exportLogFile`, `clearLogFile` (file writes) | `shared/lib/loggerFile.ts` | settings | **NONE** as behaviour; the four tests that mention it are release fixtures that mock it. |
| 29 | `loggerGlobalErrors`, `loggerRunnerLink`, `loggerRender`, `loggerScreen`, `loggerCallTiming`, `loggerTimedDerive` | `shared/lib/logger*.ts` | boot, dev tools | Pinned, one test file each. `loggerHooks`, `loggerJsThread`, `loggerUiThread`, `loggerUI.tsx`, `loggerDefer` have none (dev instrumentation). |

### Sheets, popups, pickers, prompts, gates

| # | Boundary | File | Used by | Pinned? |
|---|---|---|---|---|
| 30 | `createSheetRoute` (`none / opening / open / leaving`), `openPicker`, `pickOption`, `useSheetRouteScreen` | `shared/lib/picker/sheetRoute.ts`, `openPicker.ts`, `useSheetRouteScreen.ts` | 17 callers | Pinned: `openPicker.test.ts` (13 cases), `pickerSheet.test.tsx`, `emojiPickerSheet.test.tsx`, `pickerSheetCallers.test.tsx`. |
| 31 | `popup()` engine (toast vs sheet choice, `failure` to catalogue copy), `showToast`, `showCustomToast`, `showSheet`, `showActionSheet`, `registerToast` | `shared/lib/popup/popups/engine.tsx`, `bridge.ts` | every static popup | Partly: `serviceErrorPopup.test.ts`, `staticPopupRenderedProbe.test.ts`, `toastRenderProbeBridge.test.tsx`. Not pinned: "buttons present means sheet"; a toast called before `registerToast` is dropped with only a warning. |
| 32 | `actionMenuPopup` and its host | `shared/lib/popup/popups/actionMenu.ts`, `shared/blocks/popup/ActionMenuHost.tsx` | verb menus and confirms across the app | Pinned: `actionMenuHandoff.test.tsx`, `menuActionFailures.test.tsx`, `androidUiRegressions.test.tsx`. |
| 33 | `PopupHost` / `SheetPopup` (sheet presentation, watchdog, remount) | `shared/blocks/popup/PopupHost.tsx` (1049 lines) | root layout | Pinned for presentation: `popupHostPresentation.test.tsx` (8 cases), `popupStorePresentationNonce.test.ts`. The custom-sheet page stack, keyboard and pinned-footer state are not. |
| 34 | `sendMemoSheet` | `shared/lib/popup/popups/sendMemoSheet.tsx` | send flow | Pinned: `sendMemoSheet.test.ts`. |
| 35 | `nfcTapSheet` | `shared/lib/popup/popups/nfcTapSheet.tsx` | NFC send/receive | Not checked for a direct test (see section 6). |
| 36 | `selectNextCta`, `CTA_DEFINITIONS`, `isNewerVersion`, `describeLegacyClaim` | `shared/lib/cta/*` | `CtaHost`, settings | Pinned: `ctaSelection.test.ts`, `ctaHost.test.tsx`, `ctaScreen.test.tsx`. `describeLegacyClaim` (`oldEcashPrompt.ts`, formats a money amount for the claim prompt) has **NONE**. |
| 37 | `useLatestVersionFetch` (6 h throttle, one forced fetch for the blocking gate, writes `settingsStore.lastKnownAppVersion`) | `shared/hooks/useLatestVersionFetch.ts` | `CtaHost` | Pinned: `ctaLatestVersionFetch.test.ts` (11 cases). |
| 38 | `AppGate` and `useReinstallDetection` (terms, onboarding, locked keys) | `shared/blocks/AppGate.tsx:39-215` | root layout | Pinned: `appGateReinstallDetection.test.tsx`, `splashUncoversGatePage.test.tsx`, `nostrKeysImportedFallback.test.tsx`. |
| 39 | `RestoreGate` / `evaluateRestoreStatus`: decides from `walletLifecycleStore.restoreStatus` + `seedCreatedAt` + keychain whether the app is blocked behind recovery; writes `restoreStatus`, `seedCreatedAt` | `shared/blocks/AppGate.tsx:224-320` | inside `AppGate` | **NONE** for the decision table. `settingsRecoveryGateConfirmation.test.tsx` covers the recovery screen in gate mode, not which statuses reach it. |
| 40 | `InitializationGate` (run once per attempt, `onSuccess` only on success, retry) | `shared/blocks/InitializationGate.tsx` | migration gates | Pinned: `initializationGateRetry.test.tsx`. |
| 41 | `KeyRecoveryScreen`, `AccountMismatchScreen` | `shared/blocks/` | `AppGate`, account integrity | Pinned: `keyRecoveryScreen.test.tsx`, `accountMismatchScreen.test.tsx`, `accountIntegrityStartup.test.tsx`. |
| 42 | `NativeSplashLayoutGate` (5 state values, 7 timers) | `shared/blocks/NativeSplashLayoutGate.tsx` | root layout | One test file (`splashUncoversGatePage.test.tsx`); the fallback timers are not covered. |

### Cached reads and remaining hooks

| # | Boundary | File | Used by | Pinned? |
|---|---|---|---|---|
| 43 | `useCachedRead` (status / source derivation, supersede, seed, focus revalidate) | `shared/lib/read/useCachedRead.ts` | 8 screens | Pinned: `useCachedRead.test.tsx` (13 cases). Not pinned: `abortOnBlur`; `focusRevalidate: false`; `coldStart: 'skeleton'`; status while retrying after a failure. |
| 44 | `readLog` events, `readPolicy.readStrategyFor` | `shared/lib/read/` | 12 files | **NONE** directly (log-only). |
| 45 | `useNostrProfile`, `useNostrProfileMetadata`, `useNip05Verification`, `useWarmNip05Profiles`, `useNostrTierHealth` | `shared/hooks/` | profile and identity UI | Pinned, one or more test files each. |
| 46 | `useRelayHealth`, `useNostrPersonDisplay`, `useHeaderSearch`, `useDebouncedValue`, `useLoopClock`, `useShallowMemo`, `useUploadAbortMap`, `useRegisterKeyDerivation`, `useFonts`, `useLatestRef` | `shared/hooks/` | various | **NONE** (small; `useLatestRef` has 26 users). |
| 47 | `useAnimatedQrFrames`, `useBoundaryClock`, `useForegroundFocusEffect`, `useVisualActivityEffect`, `useScreenInsets`, `useOurP2pkPubkeys` | `shared/hooks/` | various | Pinned, one test file each. |
| 48 | `features.ts` / `featureDetectors.ts` (which modules a build includes) | `shared/config/` | 20 files | Pinned: `featureSet.test.ts`, `paymentsEditionBlockedRoutes.test.ts`. |
| 49 | `protocolIds` (`asNostrPubkeyHex`, `nostrPubkeyHexFromCashuP2pk`, ...) | `shared/lib/protocolIds.ts` | 37 files | Pinned: `isNostrPubkeyHex.test.ts`, `sendLockIdentity.test.tsx`, `useSendLock.test.tsx`. |
| 50 | `imageCache`, `imageLoadState`, `date`, `strings`, `groupBy`, `id`, `map/mapClustering`, `map/btcMapClusterCache`, `motion/keyframes`, `third-party/emoji` | `shared/lib/` | various | Pinned, at least one direct test each (`date.ts` only for `formatRelativeUnixSeconds`; `formatDate` and `formatRelative` are mocked everywhere else). |
| 51 | `map/locationPrivacy.applySafetyOffset` (750 to 1800 m session offset so the map never centres on the user), `map/categories`, `imageError` | `shared/lib/` | map, images | **NONE.** |
| 52 | Presentational UI: `shared/ui/primitives` (28 files), `shared/ui/composed` (143 files incl. `chat/`, `search/`, `QRButton/`, `BalancePill/`, `CapsuleButton/`), `shared/ui/capability`, `shared/blocks/status`, `shared/blocks/transfer`, `shared/blocks/claim` | | all screens | Mixed; most have a render or layout test (`Screen` 27, `Avatar` 17, `AmountFormatter` 14). `AmountEntryView` holds no amount state (the caller does); covered by `amountEntryAccessibility.test.tsx`, `amountSelectorLock.test.tsx`. No money logic lives here. |

**Counts.** 52 boundary groups: 27 pinned, 9 partly pinned, 16 unpinned or mock-only
(rows 1, 3, 4, 6, 7, 8, 10, 12, 16, 28, 35, 39, 44, 46, 51, and `describeLegacyClaim` in 36).

---

## 3. Likely surgery targets

1. **`usePaymentStatusListener`** (`shared/hooks/usePaymentStatusListener.ts:361-918`). An implicit state machine spread
   over nine handlers that all read and write one slot, `paymentStatusStore.active`. The phase is encoded by
   `active.variant` + `active.id` + `active.state` + `active.receiveEntryId` + `isSwapStatusActive()`, and each handler
   re-derives "is this toast mine" with a different rule: by id (`mint-op:finalized`, :453), by variant + mint + amount
   (`history:updated`, :592; `receive-op:finalized`, :664; `melt-op:rolled-back`, :772), by variant alone
   (`melt-op:finalized`, :858), by "any payment-request toast in processing/delivered" (`send:finalized`, :728).
   Two separate subscriptions to `receive-op:finalized` (:521 and :653) depend on registration order.
   **Pinned: nothing.** This is the highest-value target and the least safe to touch today.
2. **`useOnchainMeltQuote` / `watchOnchainMeltQuote`** (`shared/hooks/useOnchainMeltQuote.ts:57-227`). Phase is held in
   closure variables `interval`, `confirmTimeout`, `awaitingVerdict`, `failedVerdictReads`, `settlement`, `mounted`, plus
   five refs passed in from the hook and three React states (`storedQuote`, `watched`, `offchainSettled`).
   Polling behaviour is pinned; the annotation writes are not.
3. **`useMempoolAcceleration`** (`shared/hooks/useMempoolAcceleration.ts:54-197`). `offerState`, `acceleratingTxid`,
   `estimateRef`, `invoiceRequestRef`, `statusPollRef` and the `alreadyAccelerated` prop jointly encode
   `no offer / offered / invoice requested / polling / acknowledged`. **Not pinned.**
4. **`SheetPopup` in `PopupHost`** (`shared/blocks/popup/PopupHost.tsx:473-800`). `wasOpenRef`, `openCycle`,
   `lastPayload`, `mountedSeq`, `presentAttempt`, `presented`, `customStack`, `customNavDirection`,
   `customFooterConfig`, `isKeyboardVisible`, `pinnedFooterHeight` and three 400 ms / watchdog timers. Presentation is
   pinned (`popupHostPresentation.test.tsx`); the custom page stack is not.
5. **`RestoreGate`** (`shared/blocks/AppGate.tsx:252-320`). `hydrated` + `evaluated` + `restoreStatus`
   (`unknown / pending / in-progress / failed / complete / not-needed`) + `seedCreatedAt`. The effect treats
   `failed` and `in-progress` as "re-evaluate" (:274) while the render treats `failed` as "block" (:299).
   **Decision table not pinned.** Touches persisted `walletLifecycleStore`.
6. **`AppGate`** (`shared/blocks/AppGate.tsx:128-215`). A render-time cascade over `locked`, `error`/`isReady`,
   `hydration`, `isTermsAccepted`, `reinstallState`, `hasSeenOnboarding`, `isLoading`; it calls
   `completeOnboarding()` during render (:186). Mostly pinned.
7. **`popup/popups/payment.ts` `swapToastMounted`** (:84) is a module boolean that mirrors whether the toast library has
   the toast; `useSwapStatusListener` and the store's `active.state` complete the picture. Pinned for the normal path.
8. **Popup wrappers** (`shared/lib/popup/popups/index.ts`, 482 lines; `factory.ts`; `copy.ts`; `deleteStatus.ts`;
   `notePublished.ts`): shallow one-line wrappers over `popup()`, an interface as wide as its implementation.
   Pinned only where a caller test asserts the popup was called.
9. **`useCachedRead`** (`shared/lib/read/useCachedRead.ts:156-444`). `flight`, `failure`, `seedState`,
   `lastKeyWithData`, `abortRef`, `focusedKeyRef` derive `status` and `source` at :362-388. Well pinned except the
   options listed in row 43.
10. **Location stamping written twice** (`shared/hooks/useTransactionLocation.ts:62-65`): the same coordinates go to
    `transactionLocationStore` and to a `transactionAnnotationStore` `id:<txId>` record. A persisted-shape pass will
    want one owner. **Not pinned.**

---

## 4. Obvious defects

**D1. Background send and melt confirmations always say "sat".**
`shared/hooks/usePaymentStatusListener.ts:710` (`send:finalized`) and `:874` (`melt-op:finalized`) set
`const unit = 'sat'` and pass it to `paymentStatusStore.setActive` and `paymentStatusPopup`.
Trigger: a send or melt on a non-sat keyset (for example a `usd` mint) finalizes with no matching active toast
(app reopened, toast already dismissed, token claimed later by the recipient).
What happens: the confirmed toast formats the amount as sats, so 500 (cents) reads as "500 sats".
What should happen: use `operation.unit`, which both operation types carry (`SendOperationBase.unit`,
`MeltOperationBase.unit` in `@cashu/coco-core`); the neighbouring `melt-op:rolled-back` handler already does (:771).
Verified by reading the handler and the Coco type declarations. Display only: no stored data, migration or wire format.

**D2. An `Error` nested inside a logged object bypasses secret redaction.**
`shared/lib/loggerCore.ts:513-523`: `compactValue` returns `message: value.message` for an `Error` it meets below the
top level (inside an object, array, `Map` or `Set`). Only top-level `Error` params are passed through
`redactKnownSecretSubstrings` (:848-858).
Trigger: `log.warn('x', { ctx: { error: new Error('redeem failed for cashuB...') } })`, or an array of errors.
What happens: the token, invoice, nsec or mnemonic in the message is written verbatim to the ring buffer, the console
and the log file, and is unbounded in length.
What should happen: the same `redactKnownSecretSubstrings` treatment as the top-level branch (message and stack).
Verified by reading both branches; `loggerChild.test.ts:212` only covers the top-level case. No stored data or wire
format; it changes what the log file contains.

**D3. `swapStatusPopup` can latch "mounted" with no toast on screen.**
`shared/lib/popup/popups/payment.ts:95` sets `swapToastMounted = true` before `showCustomToast`, which returns without
showing anything and without registering `onHide` when no toast manager is registered
(`shared/lib/popup/popups/bridge.ts:175-178`).
Trigger: `swapStatusPopup()` runs before `PopupHost` has mounted and called `registerToast`
(`shared/blocks/popup/PopupHost.tsx:85`).
What happens: the flag is never reset, so every later `swapStatusPopup()` and the `useSwapStatusListener` re-pop return
early; the swap toast cannot appear again in that session.
What should happen: set the flag only when the toast was handed to the manager.
Code path verified; whether a swap can start before `PopupHost` mounts in practice is UNVERIFIED (I did not trace the
startup swap-recovery path). No stored data.

Checked and found correct (not defects): the `onchainOutpoint` guard in `useOnchainMeltOutpointDiscovery.ts:37,52`
reads the flat stored key that `wallet/src/annotations/model.ts:429` writes; `retrieveMnemonic` never throws, so
`evaluateRestoreStatus`'s `try/finally` without `catch` is safe; `useCachedRead` with `abortOnBlur` restarts or reads as
landed on refocus.

---

## 5. Proposed characterization tests (ranked)

1. **`usePaymentStatusListener` event table.** New file `__tests__/paymentStatusListener.test.tsx`. Mount the hook with
   a fake manager whose `on()` records handlers; use the real `paymentStatusStore` and `transactionAnnotationStore`;
   mock only `paymentStatusPopup` and the wallet rotation helpers. Pin:
   - bolt11 `mint-quote:updated` PAID raises a `receive` processing toast once; a second PAID for the same quote
     refreshes the store without a second popup; non-bolt11 is ignored;
   - `mint-op:pending` shows the toast only when the quote row is PAID and `updatedAt` is within 5 minutes;
   - `mint-op:finalized` confirms a matching toast; for bolt12/onchain with no matching toast it raises a confirmed
     one; an onchain deposit on the standing quote id calls `rotateReusableMintQuote`, any other id does not;
   - `receive-op:finalized` with `source.type === 'payment-request'` writes `op:<id>` with `role: 'payee'`, raises a
     confirmed `receive`, and rotates only when `requestOperationId` equals the standing id;
   - `history:updated` / `receive-op:finalized` for `receive-ecash`: `waiting` gets a new confirmed toast under the
     entry id, any other state confirms in place;
   - `send:finalized`: confirms a matching `send` toast; QUIRK: confirms any `payment-request` toast in
     `processing`/`delivered` regardless of id; otherwise raises a new confirmed toast; QUIRK: unit is `'sat'` (D1);
   - `melt-op:finalized`: writes the onchain annotation (outpoint, `feeIndex`, `feeReserveSats`, `settledOffchain` when
     no outpoint); QUIRK: confirms any `melt` toast in `processing` or `confirmed`, matching by variant only, and
     overwrites its `operationId`;
   - `melt-op:rolled-back`: fails a matching processing toast, dedupes against a matching non-processing one, else
     raises a failed toast with catalogue copy;
   - every handler is silent while `isSwapStatusActive()`; unmount unsubscribes all nine.
   Breaks if: a handler's match rule is changed (for example `melt-op:finalized` matched by quote id), a swap
   suppression is dropped, or an annotation field is renamed.
2. **`RestoreGate` decision table.** New file `__tests__/restoreGateDecision.test.tsx`, real `walletLifecycleStore`,
   mocked `retrieveMnemonic` and `SettingsRecoveryScreen`. Pin: not hydrated renders nothing; `complete` /
   `not-needed` render children without touching the keychain; `pending` shows recovery; `unknown` + mnemonic +
   `seedCreatedAt == null` becomes `pending`; `unknown` + mnemonic + marker becomes `not-needed`; `unknown` + no
   mnemonic leaves the status alone and renders children; QUIRK: `in-progress` and `failed` are re-evaluated the same
   way as `unknown` (so `failed` with a marker becomes `not-needed`); `onComplete` sets the marker and `complete`.
   Breaks if: `in-progress` is treated as blocking again, or the hydration wait is removed.
3. **`fetchMintInfo` boundary guard.** Add to `__tests__/apiClientBackendConfig.test.ts` (or a new
   `apiClientMintInfo.test.ts`) with `fetch` stubbed. Pin: `http://`, `file://` and unparseable input return `Err`
   without calling `fetch`; the URL gets exactly one `/` before `v1/info`; a body with non-string `name`, missing
   `pubkey` or missing `version` is an `ApiParseError` whose `issues` hold paths and codes but not the input; unknown
   fields pass through; 503 is `ApiHttpError` with `status`; a caller abort returns the abort error.
   Breaks if: the scheme check is removed or `MintInfoSpine` is loosened.
4. **Nested-error redaction** (pins D2 as a QUIRK until fixed). Add to `__tests__/loggerRedaction.test.ts`: an `Error`
   carrying a Cashu token under `{ ctx: { error } }` and inside an array; assert today's output, labelled QUIRK, so the
   fix is a visible one-line change to the expectation. Also pin that two top-level `Error` params keep only the last
   one in `entry.error` (QUIRK).
   Breaks if: `compactValue`'s `Error` branch changes.
5. **`useMempoolAcceleration`.** New file `__tests__/useMempoolAcceleration.test.tsx`, wallet fetchers mocked, fake
   timers. Pin: disabled / no txid / already accelerated makes no request; an acknowledged status on mount writes
   `accelerated` and hides the offer; `requestInvoice` returns null without an estimate for the current txid; two
   concurrent `requestInvoice` calls create one invoice; after an invoice the status is polled every 15 s, stops on
   acknowledgement or after 5 minutes; a txid change drops the old offer.
   Breaks if: the invoice de-duplication ref is removed or the poll deadline changes.
6. **`guardedRouter` cooldown.** New file `__tests__/guardedRouter.test.ts`, `expo-router` mocked, fake clock. Pin: a
   second `push` to the same href within 600 ms is dropped; a different href or a different method is not; object
   hrefs compare by sorted keys; QUIRK: two `back()` calls within 600 ms count as the same navigation and the second
   is dropped; `raw` is unguarded; `canGoBack` and other members pass through bound.
   Breaks if: the signature or the guarded-method set changes.
7. **`useOnchainMeltQuote` annotation writes.** Extend `__tests__/useOnchainMeltQuote.test.tsx` with the real
   annotation store. Pin: the outpoint is written once per quote with `outpointSource: 'mint'`; address and
   `amountSats` are written once, and `amountSats` only when `unit === 'sat'` and `amount` is a finite number (QUIRK:
   any other amount representation writes the address alone); the settled-off-chain verdict is written after two
   PAID-without-outpoint reads, or one when `entrySettledAtMount`; a persisted verdict does one refresh and no interval.
   Breaks if: the read threshold or the once-per-quote refs change.
8. **`useOnchainMeltOutpointDiscovery` and `describeLegacyClaim`.** Two small files. Discovery: no probe unless enabled,
   mainnet, positive finite amount; a unique match writes a `heuristic` outpoint and stops polling; an existing outpoint
   is never overwritten; no write after unmount. Claim prompt: `1 sat`, `1,234 sats`, a fiat unit formatted with its
   code, and `null` for an unknown or missing unit (so no bare number is shown).
   Breaks if: the existing-outpoint guard is dropped, or an unknown unit starts printing a number.

---

## 6. Not examined

- `shared/ui/**` (175 files) and most of `shared/blocks/**`: classified by state/effect/timer counts and by which tests
  import them; only `AppGate.tsx` and `InitializationGate.tsx` were read in full. `PopupHost.tsx`,
  `ActionMenuHost.tsx`, `NativeSplashLayoutGate.tsx`, `CtaScreen.tsx`, `CtaHost.tsx`, `AmountEntryView.tsx`,
  `LoadingIndicator.tsx`, `KeyRecoveryScreen.tsx`, `AccountMismatchScreen.tsx` were outlined, not read line by line.
  No QR scanner component lives in this area.
- `shared/lib/popup`: read `engine.tsx`, `bridge.ts`, `payment.ts`, `factory.ts`, `openWatchdog.ts`. Not read:
  `PaymentStatusToast.tsx` beyond its first 140 lines, `actionMenu.ts`, `actionMenuSheet.tsx`, `actionSheets.tsx`,
  `sendMemoSheet.tsx`, `nfcTapSheet.tsx`, `index.ts`, `copy.ts`, the E2E probes, the toast components.
- `shared/hooks`: not read: `useNostrProfile.ts`, `useNostrProfileMetadata.ts`, `useNip05Verification.ts`,
  `useNostrTierHealth.ts`, `useMempoolAddressSummary.ts`, `useMempoolTxConfirmations.ts`, `useAnimatedQrFrames.ts`,
  `useThemeColor.ts`, `useScreenInsets.tsx` and the small ones in row 46.
- `shared/lib`: not read: `loggerCore.ts` outside lines 284-590 and 800-900, every other `logger*.ts`,
  `debug/storageInventory.ts`, `debug/fadeRevealProbe.ts`, `imageCache.ts`, `imageLoadState.ts`, `imageError.ts`,
  `date.ts`, `groupBy.ts`, `constants.ts`, `protocolIds.ts` past line 60, `read/readLog.ts`, `read/readPolicy.ts`,
  `map/mapClustering.ts`, `map/btcMapClusterCache.ts`, `map/categories.ts`, `motion/keyframes.ts`,
  `third-party/emoji.ts`, `picker/types.ts`, `picker/openEmojiPicker.ts`, `cta/types.ts`,
  `config/features.ts`, `config/featureDetectors.ts`, `config/download.ts`.
- Test contents: titles were read for the files named in section 2; bodies were not, so "pinned" rests on the title
  and the import, and "mock-only" on a sample of the importing tests rather than all of them (notably the 38 tests
  that import `useGuardedRouter`).
- No test was run.
