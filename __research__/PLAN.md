# Colada Refactor Plan

## Current slice

2. Subscription bus: replace per-screen/token/lightning/onchain watchers with a typed event bus.

## Completed slices

1. Adapter contracts: defined JSON-shaped adapter interfaces, flattened `ColadaProvider` props, updated Sovran provider wiring, and verified both repos.

## Remaining slices

2. Subscription bus: replace per-screen/token/lightning/onchain watchers with a typed event bus.
3. Copy + i18n surface: move payment-state copy defaults and overrides into Colada.
4. State machines: split payment flows into per-flow discriminated-union machines.
5. Chain watcher: move mempool/chain watching behind a chain adapter.
6. Fault-tolerance fallbacks: ensure every state has forward and cancel/back actions.
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
