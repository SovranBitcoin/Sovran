# Colada Refactor Plan

## Current slice

Framework-agnostic screen-action session extraction is implemented.
`createScreenActionSession()` now owns entry parsing,
subscription-driven entry updates, merge/decorate/source behavior, action
inspection/execution, and disposal outside React. `useScreenActions()` is a
React adapter over that session via `useSyncExternalStore`.

The state-machine decision spike is also recorded in
`__research__/state-machine-decision.md`: do not adopt XState yet; formalize an
internal effect runner first, then re-evaluate XState only if it deletes custom
lock/stale-result machinery. Effect runners are now extracted for
`createMintQuote`, `confirmSend`, `confirmMelt`, `confirmPaymentRequest`, mint
review info loading, trust mint, mint-list enrichment, and background recipient
identity resolution, and NFC write-back.

## Completed slices

1. Adapter contracts: defined JSON-shaped adapter interfaces, flattened `ColadaProvider` props, updated Sovran provider wiring, and verified both repos.
2. Subscription bus: added a typed Colada bus, bound Sovran Coco/store publishers once at the provider, and moved screen-action, transaction-detail, melt-history, and split-bill history consumers onto bus subscriptions.
3. Copy + i18n surface: added a typed Colada payment-copy catalog/resolver with overrides and locale registration; moved transaction detail timeline, history refresh, and payment-status toast copy out of `sovran-app`.
4. State machines: split send/receive entry flows and context resolution into Colada machine modules; moved app-owned transaction state predicates and warning/refresh labels into Colada history helpers.
5. Chain watcher: moved mempool.space address stats, address summaries, confirmation progress, and default chain adapter into Colada; updated `sovran-app` to consume Colada chain helpers.
6. Fault-tolerance fallbacks: added a generic non-destructive `back` action to Colada screen actions, kept amount/mint selector `cancel` in the contract, and moved receive/mint dead-end close paths through Colada actions.
7. Renames/dead code: deleted the deprecated `copyAsEmoji` action path, removed the unused NFC fallback export/module, and cleaned strict-unused Colada locals without moving responsibility boundaries unnecessarily.
8. Backcompat sweep: removed implicit bolt11/sat support for mints missing NUT method-unit metadata, tightened tests to advertise methods explicitly, and removed remaining backcompat wording from shipped Colada APIs.
9. Tests reconciliation: added shipped-API coverage that emoji token copy is a `copy` variant rather than a sibling action; updated capability fixtures to reflect explicit mint method support.
10. README + CONVENTIONS: rewrote shipped docs around the flat provider, adapter contracts, copy/action/bus/chain ownership, explicit mint method metadata, and deleted obsolete flow/guide/pipeline/method docs that still described removed APIs.
11. Final sweep: removed the remaining grouped `platform` seam from `createColada`, moved Sovran clipboard/share/NFC/scan/UR wiring onto flat provider adapters, reran final gates, and recorded the handoff.
12. Screen-action sessions: added a framework-agnostic page update/session interface, moved `ScreenActionsBridge` to the core export surface, and kept Sovran's bridge app-owned while importing the contract from `colada`.
13. State-machine decision: compared XState against formalizing the current custom machine and decided to extract an internal effect runner first.
14. Mint-quote effect runner: moved `createMintQuote` auto-execution into a named internal effect that returns typed success/stale/failure results.
15. Confirm-send effect runner: moved ecash send execution into a named internal effect covering online send, local-first token creation, proof fallback, SEND_FAILED errors, transaction-created notification data, and stale async results.
16. Confirm-melt effect runner: moved the lightning melt confirmation operation into a named internal effect covering payment-confirmed notification data, transaction-created notification data, melt lifecycle notification data, transaction-link intents, failure, and stale async results.
17. Confirm-payment-request effect runner: moved payment request confirmation into a named internal effect covering payment-confirmed notification data, transaction-created notification data, transaction-link intents, rolledBack outcomes, failure, and stale async results.
18. Mint review effects: moved mint-review info loading and trust-mint execution into named internal effects covering enriched step data, trust completion, error step data, and stale async results.
19. Mint-list enrichment effect: moved selectMint row enrichment into a named internal effect covering enriched rows, failure, and stale async results while preserving fallback-row timing.
20. Recipient identity effects: moved background Lightning Address → pubkey and pubkey → profile resolution into named internal effects covering resolved, empty, failed, and stale async results.
21. NFC write-back effect: moved NFC token creation, tag writing, session release, rollback-on-write-failure, success notification data, transaction-link intents, write-failure notification data, and stale async results into a named internal effect.

## Remaining slices

None.

## Invariants

- ✅ Colada owns payment-flow sequencing.
- ✅ Colada owns payment-state copy.
- ✅ Colada owns side-effect channels.
- ✅ Colada owns the update/subscription model.
- ✅ Colada owns mempool/chain watching.
- ✅ Colada is unopinionated about native libs.
- ✅ Users never get stuck without a forward action and non-destructive cancel/back.
- ✅ No backwards-compatibility code except allowed carve-outs.

## Discovered while working

- Baseline before slice 1: `colada` type-check passed and 557 tests passed.
- Baseline implementation exposed grouped `engine/callbacks/runtime/platform` provider props despite README's flat API goal.
- `sovran-backcompat-guard` skill file was not installed; apply the three-gate test from `GOAL.md` directly.
- Audit 23's receive scan permission issue appears fixed in current code by owning `useHandleCameraPermission()` inside `features/send/providers/Colada.tsx`.
- Slice 1 verification: `colada` type-check/tests passed, `sovran-app` type-check/tests passed, touched-file lint passed, and app error-only lint passed.
- Slice 2 verification: `colada` type-check/tests passed, `sovran-app` type-check/tests passed, touched-file lint had warnings only, app tests passed, and app error-only lint passed.
- Payment-status toasts still listen to Coco directly; fold them into Colada's side-effect channel slice instead of overloading the detail-update bus slice.
- Slice 3 verification: `colada` type-check/tests passed, `sovran-app` type-check/tests passed, focused timeline tests passed, app tests passed, touched-file lint had warnings only, app error-only lint passed, and both diffs passed `git diff --check`.
- Copy invariant stayed open through slice 3 until flow-screen action/error states were declared in the machine and fallback slices.
- Avoid importing `colada/react` hooks in app render-tested surfaces while `colada` is a local `file:` dependency; Jest resolves Colada's dev React copy. App surfaces use the root Colada resolver instead.
- Slice 4 progress: send/receive entry transitions now delegate to per-flow modules with state/action/copy-key declarations; transaction timeline, filter, and detail-screen state predicates moved from `sovran-app` into Colada history.
- Slice 4 progress: send-token reachability warnings, history refresh labels, chart predicates, pending-send balance predicates, and notification/reconciliation state checks now use Colada history helpers instead of app-owned payment-state branches.
- Slice 4 progress: amount/mint context resolution, mint selector routing, mint capability revalidation, and proof-selector fallback moved from `transitions.ts` into a dedicated Colada machine resolver module.
- Slice 5 progress: mempool.space address stats, address summaries, onchain confirmation progress, and the default chain adapter moved into Colada; `sovran-app` now imports those helpers from Colada and passes a Colada chain adapter to the provider.
- Slice 4 verification: `colada` type-check/tests passed; `sovran-app` type-check/tests passed; focused and full app tests passed; touched-file lint had existing perf warnings only; app error-only lint passed.
- Slice 5 verification: `colada` type-check passed and 590 tests passed; `sovran-app` type-check passed, 379 tests passed, and app error-only lint passed.
- Slice 6 progress: every Colada screen-action surface now exposes a default `back` handler; amount entry and mint selector also expose `cancel`; receive-token, mint-quote, onchain receive, payment-request terminal, amount-entry error, receive hub error, and mint-info close/reject paths now route through Colada actions instead of direct screen-local back calls.
- Slice 6 verification: focused Colada screen-action tests passed; `colada` type-check passed and 612 tests passed; `sovran-app` type-check passed, 379 tests passed, app error-only lint passed, and both diffs passed `git diff --check`; `colada` still has no lint script.
- Slice 7 progress: `copy.variants[emoji]` is now the only emoji-token path; `copyAsEmoji` was removed from Colada and Sovran overrides; unused config destructures/helpers/imports and the unused `nfc-fallback` public export were deleted.
- Slice 7 verification: `colada` type-check, strict no-unused type-check, and 612 tests passed; `sovran-app` type-check, 379 tests, app error-only lint, and both `git diff --check` runs passed.
- Slice 8 progress: missing NUT method-unit metadata now means unavailable instead of assuming bolt11/sat; test wallets now declare bolt11 support explicitly; Sovran copy override comments no longer describe legacy callers.
- Slice 8 verification: `colada` type-check, strict no-unused type-check, and 612 tests passed; `sovran-app` type-check, 379 tests, app error-only lint, and both `git diff --check` runs passed.
- Slice 9 progress: send-token availability now asserts emoji copy stays under `copy.variants` and `copyAsEmoji` is not a runtime action.
- Slice 9 verification: `colada` type-check, strict no-unused type-check, and 613 tests passed; `sovran-app` type-check, 379 tests, app error-only lint, and both `git diff --check` runs passed.
- Slice 10 progress: `README.md` and `docs/CONVENTIONS.md` now describe the shipped flat React API, adapter philosophy, subscription bus, default chain adapter, screen-action contract, and explicit mint method support; obsolete docs pages under `docs/flows`, `docs/guide`, `docs/methods`, and `docs/pipeline` were deleted instead of patched around stale examples.
- Slice 10 verification: `colada` type-check, strict no-unused type-check, and 613 tests passed; `sovran-app` type-check, 379 tests, app error-only lint, and both `git diff --check` runs passed.
- Slice 11 progress: the remaining `createColada({ platform: ... })` group was removed; platform primitives are now flat `ColadaProvider` adapters in Sovran, and `ColadaProvider` no longer reads platform primitives from the instance config.
- Slice 11 final verification: `colada` type-check passed; `colada` strict no-unused type-check passed; `colada` tests passed (41 files, 613 tests); `sovran-app` type-check passed; `sovran-app` app error-only lint passed; `sovran-app` tests passed (58 suites, 379 tests); both repos passed `git diff --check`; `colada` has no lint script.
- Final stale-doc sweep found no removed grouped-provider or removed-action references in `README.md` or `docs/`; `colada/__research__/PLAN.md` is the only scratch file left under `colada/__research__`.
- Fresh architecture goal progress: `createScreenActionSession()` is the non-React page-update interface for screen actions; React's hook now delegates to it. Non-React tests cover entry refresh, source refresh via `screenActions.changed`, mint-info enrichment, and mint-selector item adds. Verification for this slice passed with `bun run type-check`, `bun run test` in `colada`, plus `npm run type-check`, focused bridge Jest, and touched-file ESLint in `sovran-app`.
- XState decision progress: current evidence shows `createMachine.ts` still owns
  async effects, notifications, manual locks, stale-result checks, NFC cleanup,
  and handler dispatch. The next implementation slice should extract a named
  internal effect runner before any XState prototype.
- Effect-runner progress: `runMintQuoteEffect()` is the first extracted effect.
  It uses a `ResultAsync` contract, carries `onTransactionCreated` as data,
  preserves stale-result behavior, and leaves `confirmSend` as the next
  high-payoff effect extraction candidate.
- Confirm-send effect progress: `runConfirmSendEffect()` is the second extracted
  effect. It keeps `PaymentMachine` public methods stable while moving online
  send, local proof sends, proof-selector fallback, final SEND_FAILED mapping,
  and transaction-created notification payload construction behind a typed
  `ResultAsync` contract.
- Confirm-melt effect progress: `runConfirmMeltEffect()` is the first
  funds-at-risk confirmation effect extracted from `createMachine.ts`. It keeps
  failure routing, `onPaymentProcessing`, locking, and handler dispatch in the
  machine while returning step data, link intents, success notification payloads,
  stale completion, and typed failure from the effect.
- Confirm-payment-request effect progress:
  `runConfirmPaymentRequestEffect()` is the second funds-at-risk confirmation
  effect extracted from `createMachine.ts`. It keeps per-call rolledBack
  holders, `onPaymentProcessing`, failure/fallback routing, locking, and handler
  dispatch in the machine while returning step data, link intents, success
  notification payloads, typed rolledBack outcomes, stale completion, and typed
  failure from the effect.
- Mint review effect progress: `runMintReviewInfoEffect()` and
  `runTrustMintEffect()` now cover the review/open mint enrichment and trust
  approval operations. They keep execution flags, step application, handler
  dispatch, and error notifications in the machine while returning enriched step
  data, trust completion, stale completion, and typed error step data.
- Mint-list enrichment progress: `runMintListEnrichmentEffect()` now covers the
  selectMint metadata enrichment operation. It keeps background scheduling,
  current-step checks, fallback rows, and notification timing in the machine
  while returning enriched rows, stale completion, and typed failure from the
  effect.
- Recipient identity effect progress: `runRecipientPubkeyEffect()` and
  `runRecipientProfileEffect()` now cover background Lightning Address → pubkey
  and pubkey → profile resolution. They keep scheduling, current-context
  application guards, step-data mirroring, and notifications in the machine
  while returning resolved, empty, failed, and stale results from typed
  `ResultAsync` contracts.
- NFC write-back effect progress: `runNfcWriteBackEffect()` now covers NFC token
  creation, tag writing, session release, rollback-on-write-failure, success
  notification data, transaction-link intents, write-failure notification data,
  and stale async results. It keeps NFC auto-resolution, execution flags,
  progress notification timing, step application, and handler dispatch in the
  machine.

## What shipped

1. Adapter contracts: `colada` 8191886; `sovran-app` 26cdd527.
2. Subscription bus: `colada` 122bf01; `sovran-app` 9f01f48e.
3. Copy + i18n surface: `colada` 0b98016; `sovran-app` 46be03ef.
4. State machines: `colada` 5a809cb; `sovran-app` b197e770.
5. Chain watcher: `colada` 71cf4ca; `sovran-app` 5565896c.
6. Fault-tolerance fallbacks: `colada` b860b30; `sovran-app` 327df5a8.
7. Renames/dead code: `colada` 0eaf284; `sovran-app` 69fee325.
8. Backcompat sweep: `colada` 7c71426; `sovran-app` e398046d.
9. Tests reconciliation: `colada` 5b5a73d; `sovran-app` no code changes.
10. README + CONVENTIONS: `colada` 0fcacb4; `sovran-app` no code changes.
11. Final sweep: `colada` this final-sweep commit; `sovran-app` 33edbd07.
12. Screen-action sessions: `colada` 566a223.
13. State-machine decision: `colada` this docs/API commit.
14. Mint-quote effect runner: `colada` 7ac9765.
15. Confirm-send effect runner: `colada` 7ac9765.
16. Confirm-melt effect runner: `colada` 7ac9765.
17. Confirm-payment-request effect runner: `colada` 7ac9765.
18. Mint review effects: `colada` 7ac9765.
19. Mint-list enrichment effect: `colada` 7ac9765.
20. Recipient identity effects: `colada` 7ac9765.
21. NFC write-back effect: `colada` 7ac9765.
