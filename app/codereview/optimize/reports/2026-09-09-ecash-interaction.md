# Ecash interaction investigation — 2026-09-09

This pass addresses delayed Create ecash entry, amount submission, and cancellation feedback. All transfers in tests used fake operations; no live funds were moved. No persisted store shape, reservation lock, cryptographic operation, payment timeout, or recovery policy changed.

## Measured bottleneck and implementation

Root log triage reported 79 `offline.composeSatoshis.result` events totaling 30,630 ms, p95 1,298.7 ms, and 24 `offline.composeFiat.result` events totaling 17,082 ms, p95 2,549.2 ms. These nested timings must not be added together. Six repeated Create ecash taps and a roughly 5.5-second cancellation were observed in the supplied session.

`AmountSelector` already binds its pending indicator to the action and machine. The amount action manager synchronously derives suggestions on first inspection. Previously `composeSatoshis` enumerated every subset for up to 20 proofs, or used meet-in-the-middle sorting for larger balances, including ordinary power-of-two proof sets. This work blocks React from rendering or responding to subsequent taps.

`wallet/src/offline.ts` now detects safe-integer divisible denomination chains. A descending greedy pass computes the greatest reachable lower amount; complementing the greatest subset at `total - target` gives the exact upper amount. Duplicate denominations, missing powers, nonbinary divisible chains, and non-unit gcd are supported. Nondivisible denominations retain the existing algorithms. The result's nonpersisted `strategy` union adds `denomination-greedy` for truthful diagnostics.

Desktop Bun comparison used the actual `createAmountActionManager`, current caller code, and a temporary copy containing the Git HEAD version of `offline.ts`. Fixture: 40 proofs, `2 ** (index % 20 + 1)`, BTC price 100,000 USD, sat account, default suggestions. Single-run observations, not device/frame-rate measurements:

| Operation | Before | After |
| --- | ---: | ---: |
| First inspect including default suggestions | 533.53 ms | 0.872 ms |
| Input 1,999,999 and inspect | 50.91 ms | 0.071 ms |
| Fiat toggle and input 19.99 | 12.39 ms | 0.053 ms |

Both runs produced 11 initial suggestions, the same effective amount, and the same offline eligibility. Direct single-composition fixtures previously took 45.5 ms for 20 proofs and 58.6 ms for 40 proofs. An 80-proof regression also exposed inaccurate old nearest bounds caused by the 40-proof prefilter: 1,998,848 / 2,000,896 instead of exact 1,999,998 / 2,000,000. The divisible path uses the entire proof multiset and returns the exact bounds.

## Cancellation handoff

`ButtonHandler` intentionally closes overflow menus immediately and does not retain their asynchronous presentation. `SendTokenScreen` previously ignored `actions.cancel.loading`, so cancellation appeared inert after the menu closed. Cancellation now scrolls to the existing timeline and morphs its pending checkpoint into a loading indicator. Token sharing/copy/NFC/status/cancel controls are disabled during the operation, while the QR remains visible. Confirmed rollback supplies the returned-funds checkpoint; failure restores the actual pending timeline and existing error notification. The screen's financial state still follows authoritative history events.

The UI follow-up removes the separate cancellation banner and blank-QR replacement. The timeline scroll target is measured relative to the native scroll content, with the existing header inset applied. Terminal QR removal reanchors the timeline without another animated scroll; reduced motion disables the initial scroll animation. Regression coverage exercises pending, failure, retry, confirmed rollback, duplicate layout callbacks and both reduced-motion settings.

`createScreenActionManager` now drops a repeated invocation of the same pending action before any await. Tests reproduced two rollback invocations before the fix and one after. Different actions remain independent, failures clear loading, and subsequent retries work. The guard also protects a reopened menu holding an older action snapshot.

The send-token QR card now reserves its existing shared loading geometry while token content is absent, coordinated with the rendering pass.

## Proof suggestion freshness

`WalletContextProvider` previously refreshed its proof-denomination snapshot only when totals, unit, manager, or mint set changed. Reserving proofs or swapping denominations at the same total could leave stale offline suggestions. Installed Coco SQL also confirms `getReadyProofs` includes reserved ready proofs; `getAvailableProofs` excludes them using `usedByOperationId IS NULL`. The provider now excludes reserved proof records, immediately hides invalidated suggestions, and listens to saved/state-changed/reserved/released/deleted/wiped proof events for its current trusted mints. It permits one active read plus one coalesced trailing read, discards invalidated results, and detaches listeners at manager/unit/scope changes and unmount. A 20-event burst produces two read batches. [ProofRepository](https://github.com/cashubtc/coco/blob/7dada8305be1c0a1e6b1ecaa9d53a91c5686771c/packages/sql-storage/src/repositories/ProofRepository.ts)

All 16 actual-provider tests pass, including seven new regressions captured failing before the change: four equal-total denomination event cases, reservation/release changes, a coalesced burst with no stale publication, and manager/mint/unmount subscription isolation. Existing first-commit scope and equivalent-input tests remain green.

## Send completion history lookup

The shared `findSendHistoryEntryByOperationId` helper now calls Coco's `history.getHistoryEntryById(operationHistoryId('send', operationId))` instead of fetching and scanning 50 history entries. This preserves the latest authoritative state and full returned metadata while avoiding unrelated history materialization for direct, offline, NFC and payment-request send helper callers. Two operation tests failed before the change and passed after, checking the direct/offline paths do not call pagination and retain finalized status, unit, amount, metadata and memo. Two more cases verify the existing operation-derived fallback for missing or mismatched history. Default operation tests now total 33.

Immediate navigation from an operation-only projection was not implemented: the current send-token bridge subscribes to future events without an initial history hydration read, so a terminal event between execution and subscription could be missed. This pass retains the targeted read to preserve current authoritative behavior.

## Verified payment boundaries

All 82 offline wallet suites passed with 1,207 tests after the denomination, action deduplication and targeted history lookup changes. These are state-machine/contract tests, not proof of live mint or native UI behavior.

| Boundary | Test coverage exercised |
| --- | --- |
| Ecash entry → amount → local/send completion | `flows/ecash-send` (32); new `flows/ecash-interaction` (3) checks busy before deferred settlement, duplicate amount submission, online/offline local selection, real amount-manager snapshot/fiat/suggestion behavior |
| Locked ecash | `flows/ecash-send-p2pk` (10), preserving prohibition on bearer-token offline fallback |
| Lightning melt and quote ownership | `flows/lightning-melt` (22), `flows/quote-first-melt` (5), `flows/confirm-dead-end` (2) |
| Payment requests | `flows/payment-request` (11), request codec contract (7), standing request unit tests (11) |
| BIP321/onchain selection | `flows/bip321-multi-option` (9), BIP321 unified (5), chain (24), receive-method mint selector (4) |
| Receive token and mint quote | `flows/receive-token` (12), `flows/mint-quote` (21), reusable quotes (10), NPC mint selector (2) |
| Reset, interruption, back navigation | `flows/interruptions` (13), `flows/back-nav-reentry` (12), machine invariants (5 property tests) |
| Screen-action cancellation outcomes | Default handlers (73), availability (60), new pending actions (3): synchronous pending, duplicate prevention, success/failure notifications, unchanged financial state, independent status action and retry |
| Composition math | Offline unit tests (29), independent reference-model property tests (350 cases), new divisible tests (400 randomized cases plus 4 fixed cases, including non-greedy counterexample) |
| App presentation | SendTokenCopyMenu (2), AmountSelector P2PK indicator, AmountEntry accessibility, LightningSendDismiss: 4 suites / 8 tests |
| Live proof suggestions | WalletContextProofAmounts: 16 actual-provider tests, including first-commit scope guards, reserved proof exclusion and same-total event freshness |

Wallet typecheck, scoped app lint and diff whitespace validation passed. Root owns final combined app typechecks/export and full app validation. A coordinated test-only Expo router stub was added to `lightningSendDismiss.test.tsx` after the navigation pass made its existing partial mock insufficient.

## Exact dependency conclusions

Installed Coco 2.0.0 source was compared with commit `7dada8305be1c0a1e6b1ecaa9d53a91c5686771c`; cashu-ts 5.0.0-rc.4 with `35cf7a63fdef28b960c148aa4d6db0c708968673`.

- Coco's default send handler first selects available proofs, reserves them, and uses existing proofs without a swap when exact. Non-exact sends create outputs and call the mint. Reclaiming an already-issued pending token uses `wallet.receive` to swap back, whereas cancelling a prepared token releases its reservation. A several-second pending cancellation cannot safely be replaced by an optimistic balance change. [DefaultSendHandler](https://github.com/cashubtc/coco/blob/7dada8305be1c0a1e6b1ecaa9d53a91c5686771c/packages/core/infra/handlers/send/DefaultSendHandler.ts)
- Send preparation/execution retain operation and mint locks and persisted state transitions. Those were not bypassed. [SendOperationService](https://github.com/cashubtc/coco/blob/7dada8305be1c0a1e6b1ecaa9d53a91c5686771c/packages/core/operations/send/SendOperationService.ts)
- Coco caches wallets for five minutes and deduplicates wallet construction. Cache misses call `ensureUpdatedMint`, which can refresh stale mint metadata/keysets. Thus an exact-proof send avoids the swap but its entire preparation path cannot universally be described as network-free. [WalletService](https://github.com/cashubtc/coco/blob/7dada8305be1c0a1e6b1ecaa9d53a91c5686771c/packages/core/services/WalletService.ts)
- cashu-ts proof selection is a separate fee-aware randomized algorithm, with 60 trials and a one-second trial budget check. It chooses actual proof objects; this pass changes only Sovran's amount composition analysis, and does not replace the dependency's funds-selection algorithm. [SelectProofs](https://github.com/cashubtc/cashu-ts/blob/35cf7a63fdef28b960c148aa4d6db0c708968673/src/wallet/SelectProofs.ts)

## Remaining measurements and limitations

- Re-run on Android and iOS Hermes with actual wallet denomination counts. Desktop milliseconds are evidence of removed work, not a claimed device latency or FPS result.
- Nondivisible large proof sets retain the prior bounded approximate prefilter and potentially expensive subset-sum work; a general exact subset-sum replacement needs a separate resource-budget contract.
- After Coco executes a send, the app still awaits one targeted history read before falling back to an operation-derived entry. Database transaction/queue delays may remain even after removing composition stalls; eliminating that wait requires an explicit initial hydration contract that cannot miss terminal events before screen subscription.
- A late data-layer completion or recovery path outside the tested scopes is not covered by a universal cancellation claim. No live expiry/redeem race, server outage, wallet restore, or native navigation measurement was performed.
