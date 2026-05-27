# Colada Refactor Plan

## Current slice

7. Renames/dead code: restructure folders around responsibilities and delete unused exports.

## Completed slices

1. Adapter contracts: defined JSON-shaped adapter interfaces, flattened `ColadaProvider` props, updated Sovran provider wiring, and verified both repos.
2. Subscription bus: added a typed Colada bus, bound Sovran Coco/store publishers once at the provider, and moved screen-action, transaction-detail, melt-history, and split-bill history consumers onto bus subscriptions.
3. Copy + i18n surface: added a typed Colada payment-copy catalog/resolver with overrides and locale registration; moved transaction detail timeline, history refresh, and payment-status toast copy out of `sovran-app`.
4. State machines: split send/receive entry flows and context resolution into Colada machine modules; moved app-owned transaction state predicates and warning/refresh labels into Colada history helpers.
5. Chain watcher: moved mempool.space address stats, address summaries, confirmation progress, and default chain adapter into Colada; updated `sovran-app` to consume Colada chain helpers.
6. Fault-tolerance fallbacks: added a generic non-destructive `back` action to Colada screen actions, kept amount/mint selector `cancel` in the contract, and moved receive/mint dead-end close paths through Colada actions.

## Remaining slices

7. Renames/dead code: restructure folders around responsibilities and delete unused exports.
8. Backcompat sweep: remove old/legacy/dual-shape paths except allowed carve-outs.
9. Tests reconciliation: rewrite tests for the shipped API and add coverage for new seams.
10. README + CONVENTIONS: rewrite docs to match the shipped architecture.
11. Final sweep: rerun gates, tick invariants, and record slice commit SHAs.

## Invariants

- ⬜ Colada owns payment-flow sequencing.
- ⬜ Colada owns payment-state copy.
- ⬜ Colada owns side-effect channels.
- ⬜ Colada owns the update/subscription model.
- ⬜ Colada owns mempool/chain watching.
- ⬜ Colada is unopinionated about native libs.
- ⬜ Users never get stuck without a forward action and non-destructive cancel/back.
- ⬜ No backwards-compatibility code except allowed carve-outs.

## Discovered while working

- Baseline before slice 1: `colada` type-check passed and 557 tests passed.
- Current implementation still exposes grouped `engine/callbacks/runtime/platform` provider props despite README's flat API goal.
- `sovran-backcompat-guard` skill file was not installed; apply the three-gate test from `GOAL.md` directly.
- Audit 23's receive scan permission issue appears fixed in current code by owning `useHandleCameraPermission()` inside `features/send/providers/Colada.tsx`.
- Slice 1 verification: `colada` type-check/tests passed, `sovran-app` type-check/tests passed, touched-file lint passed, and app error-only lint passed.
- Slice 2 verification: `colada` type-check/tests passed, `sovran-app` type-check/tests passed, touched-file lint had warnings only, app tests passed, and app error-only lint passed.
- Payment-status toasts still listen to Coco directly; fold them into Colada's side-effect channel slice instead of overloading the detail-update bus slice.
- Slice 3 verification: `colada` type-check/tests passed, `sovran-app` type-check/tests passed, focused timeline tests passed, app tests passed, touched-file lint had warnings only, app error-only lint passed, and both diffs passed `git diff --check`.
- Copy invariant remains unticked: detail/timeline/history/toast copy now comes from Colada, but flow-screen action/error copy should move when those states are declared in the machine and fallback slices.
- Avoid importing `colada/react` hooks in app render-tested surfaces while `colada` is a local `file:` dependency; Jest resolves Colada's dev React copy. App surfaces use the root Colada resolver instead.
- Slice 4 progress: send/receive entry transitions now delegate to per-flow modules with state/action/copy-key declarations; transaction timeline, filter, and detail-screen state predicates moved from `sovran-app` into Colada history.
- Slice 4 progress: send-token reachability warnings, history refresh labels, chart predicates, pending-send balance predicates, and notification/reconciliation state checks now use Colada history helpers instead of app-owned payment-state branches.
- Slice 4 progress: amount/mint context resolution, mint selector routing, mint capability revalidation, and proof-selector fallback moved from `transitions.ts` into a dedicated Colada machine resolver module.
- Slice 5 progress: mempool.space address stats, address summaries, onchain confirmation progress, and the default chain adapter moved into Colada; `sovran-app` now imports those helpers from Colada and passes a Colada chain adapter to the provider.
- Slice 4 verification: `colada` type-check/tests passed; `sovran-app` type-check/tests passed; focused and full app tests passed; touched-file lint had existing perf warnings only; app error-only lint passed.
- Slice 5 verification: `colada` type-check passed and 590 tests passed; `sovran-app` type-check passed, 379 tests passed, and app error-only lint passed.
- Slice 6 progress: every Colada screen-action surface now exposes a default `back` handler; amount entry and mint selector also expose `cancel`; receive-token, mint-quote, onchain receive, payment-request terminal, amount-entry error, receive hub error, and mint-info close/reject paths now route through Colada actions instead of direct screen-local back calls.
- Slice 6 verification: focused Colada screen-action tests passed; `colada` type-check passed and 612 tests passed; `sovran-app` type-check passed, 379 tests passed, app error-only lint passed, and both diffs passed `git diff --check`; `colada` still has no lint script.
