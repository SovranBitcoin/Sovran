# 0006 — React Compiler supersedes the react-perf eslint rules; verified manual-memoization sweep

Status: accepted (corrected in part by [0007](0007-react-compiler-coverage-gate.md))
Date: 2026-06-24

## Context

A React Doctor pass flagged 890 `react-compiler-no-manual-memoization` findings
("delete this `useMemo`/`useCallback`/`memo` — React Compiler already caches it").
React Compiler **is** enabled here (`app.json` `experiments.reactCompiler: true`
via `babel-preset-expo`), so the premise is sound in principle.

But the rule collided with a deliberately-documented project policy. `eslint.config.js`
carried three `react-perf/jsx-no-new-{object,array,function}-as-prop` rules at `warn`,
with a comment stating they were **intentionally paired** with the react-compiler
eslint rule: *"react-perf flags the props that would prevent memoisation even with
the compiler active."* In other words, prior intent was to keep prop-stabilizing
memoization. Blanket-deleting memos that feed JSX props therefore did not *remove* a
problem — it *traded* a react-doctor finding for a react-perf finding (measured: a
single representative file produced 9 new react-perf warnings).

Two of the "top 3" rules in the same report were also confirmed **false positives**
and were left untouched (recorded here so they are not "re-fixed" later):

- `rn-no-non-native-navigator` (×3): the recipe's fix target
  `@react-navigation/native-drawer` does not exist (npm 404); the sites are a
  deliberate `expo-router/drawer` surface, a `useDrawerProgress` animation hook, and
  a **type-only** `BottomTabBarProps` import — none has a native-stack equivalent.
- `js-length-check-first` (×2): both are the rule's **own** documented exceptions —
  one already has the length guard on the preceding line (`feedRows.ts:212`), the
  other is an intentional prefix-match (`_layout.tsx:124`) where adding a length
  check would break active-route detection.

## Decision

1. **React Compiler is the source of truth for memoization; remove the react-perf
   rules.** Deleted the three `react-perf/*` rules, their explanatory comment, the
   plugin `require`, and the `eslint-plugin-react-perf` devDependency. The compiler's
   auto-memoization (validated per-site, below) supersedes the manual prop-stability
   lint. No shim, no downgrade-to-off — the rules are gone.

2. **Sweep manual memoization, but only where the compiler provably covers it.** The
   removal set was bounded by what `react-compiler-no-manual-memoization` flagged,
   minus everything load-bearing:
   - **Kept**: every `React.memo`/`memo()` render-bailout wrapper (57) — *but see
     [0007](0007-react-compiler-coverage-gate.md): the FIRST pass (`584186b4`),
     predating this policy, had already stripped 20 wrappers; 0007 restores them* —
     every
     `preserve-manual-memoization` site (the compiler's own "cannot auto-memoize"
     signal), every memo with an explanatory comment above it, and every
     generic-typed `useMemo<T>`/`useCallback<T>` (dropping the type arg breaks
     inner-param inference).
   - **Skipped**: any `useMemo`/`useCallback` whose binding is consumed by a hook
     **dependency array** (removing it makes the dep unstable → the effect re-fires
     every render), and any multi-statement block-bodied `useMemo` (not safely
     inlinable).

3. **`preserve-manual-memoization` is the guardrail, not react-perf.** A removed memo
   that fed a `React.memo` child's bailout stays correct **only** if the compiler
   keeps that value stable. The compiler-bailout detector is
   `preserve-manual-memoization`; any file where the sweep produced a *new* preserve
   finding was reverted wholesale (8 sites across 2 files, plus 14 other files with
   genuine new findings).

## Verification

Methodology (per react-doctor's own `--scope changed --base <ref>` design, plus a
full before/after count delta against the HEAD report):

- Representative sample first (`sendMemoSheet.tsx`): of 15 flagged memos, 12 removed,
  3 reverted (caught by `--scope changed` as effect-deps regressions), 1 pure
  function hoisted to module scope.
- Bulk AST codemod (string-splicing, formatting-preserving) over the rest, then
  `prettier` + `eslint --fix` (unused-import cleanup), guarded by a per-`(file,rule)`
  count comparison against the original full report.
- **Outcome: total issues 2434 → 2121, manual-memoization findings 890 → 580
  (310 cleared), and zero net-new issues of any rule.** `tsc --noEmit`, `eslint`
  (0 errors), and `knip` all clean.

## Consequences

- Prop-stability is now the compiler's responsibility, not a lint gate. If a
  component ever opts out of the compiler (`"use no memo"`) or trips a compiler
  bailout, `preserve-manual-memoization` — not react-perf — is what will flag the
  manual memo that must stay.
- ~270 memo findings remain (block-bodied `useMemo`, generics, dep-array-referenced
  bindings, commented memos, and the 16 reverted files). These are intentionally
  out of scope for this pass and can be revisited individually.
- The two false-positive rule clusters above are documented so future passes skip
  them rather than re-attempting an impossible "fix."
