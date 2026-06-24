# 0007 — React.memo render-bailouts are not compiler-replaceable; coverage gate

Status: accepted
Date: 2026-06-24

## Context

An audit of the React-Compiler manual-memoization sweep (ADR 0006, plus the two
earlier passes) against React's official "don't strip memos blindly" guidance
(react.dev/blog/2025/10/07/react-compiler-1) found that **the first pass
(`584186b4`) removed ~20 `React.memo`/`memo()` wrappers and never restored
them** — including the app's most render-sensitive components: charts
(`MonthlyChart`, `SpentThisMonth`, `ReceivedThisMonth`, `StatsCard`), animated /
visual surfaces (`AnimatedBackgroundView`, `ScrollableGradientOverlay`,
`PatternBackground`, `WallpaperThumbnail`, `GlassSearchBar`, `AndroidHeaderScrim`),
feed media (`ImageBlock`, `LinkEmbedView`, `MemoizedMediaPagerPage`), and transfer /
transaction list rows (`TransferCard`, `TransferEntryRow`, `TransferSeparator`,
`TransferErrorBanner`, `CollapsedLegGroup`, `SwapTransactionRow`, `UnitPreviewCard`).

This matters because **`React.memo` is a different mechanism from value
memoization, and the React Compiler does not reliably replace it.** `useMemo` /
`useCallback` cache a value *inside* a render; the compiler reproduces that. But
`React.memo` is a *props-comparison render bailout* — it stops the component from
re-rendering at all when its props are shallow-equal. The compiler only avoids a
child re-render when the *parent* is compiled and hands back a referentially stable
element; for an expensive leaf rendered across many call sites (a chart, an animated
background, a virtualized list row), the explicit `React.memo` was the author's
deliberate, guaranteed bailout. React's guidance is explicit: **keep `React.memo`.**

Runtime logs corroborated the regression. A `log-doctor renders` pass over an
on-device session showed the three instrumented stripped components re-rendering
repeatedly — `tx.monthly_chart.render` 6×, `bg.view.render` 7×,
`ScrollableGradientOverlay` 4× — matching the user-reported lag.

**Root cause of why it went undetected:** the `react-compiler/react-compiler` ESLint
rule — which surfaces compiler bailouts and is the tool React's guidance names for
exactly this — **never runs**. It throws at config load under the repo-wide `zod@4`
override (`eslint.config.js` loads it in a `try/catch` that falls back to `null`),
and `eslint-plugin-react-hooks` is v5.2.0 (no react-compiler rule). So no automated
check caught the stripped wrappers, and none would catch a future compiler bailout.

A secondary miss: the sweep's "skip bindings consumed by a dependency array" guard
only inspected the **same file**. `getMintInfo` (`useMintManagement`) was
de-memoized despite feeding `useEffect` deps in *consumer* files (`useMintInfo.ts`,
`useMintContacts.ts`) — the cross-file escape-hatch case React's point #1 names.

## Decision

1. **Restore every stripped `React.memo`/`memo()` wrapper (20 components).** They
   were author-intended render bailouts; the compiler does not replace them. A bare
   shallow-compare on a component the compiler already covers is harmless; removing
   it was the error.

2. **Restore `getMintInfo`'s `useCallback([manager])`.** A callback consumed as a
   `useEffect` dependency in a consumer hook is the effect-dependency escape hatch —
   keep it regardless of whether the compiler happens to stabilize it.

3. **Add a React Compiler coverage gate** (`scripts/check-react-compiler.mjs`, npm
   `check:react-compiler`, CI step after Knip). It runs the compiler's own
   `react-compiler-healthcheck` and **fails when compiled < total**. This restores
   the bailout signal the dead ESLint rule was supposed to provide, using the
   compiler itself as the source of truth rather than an approximation.

## What was NOT changed (verified clean)

- **Compiler bailouts: none.** `react-compiler-healthcheck` reports 596/596
  components compile. React's "manual memo still load-bearing in a bailout file"
  concern does not apply here — there are no bailout files.
- **Value-`useMemo`s feeding dep arrays (the dep-array sites flagged in triage):**
  left removed. The compiler re-memoizes a value keyed on the same inputs the manual
  `useMemo` used; removing it does not destabilize a dependency when the compiler
  compiles the component (which it does, everywhere). Primitives in dep arrays are
  value-compared regardless. These are not regressions.
- The `npub_to_pubkey` / `mint.info.fetch.success` log volume is `debug`-level and
  largely over-logging on hot pure-function / SWR-cache-read paths — a logging-noise
  question, not a memoization regression, and out of scope here.

## Consequences

- The compiler-coverage premise is now enforced in CI, not assumed. A new bailout —
  or a future over-aggressive memo removal that induces one — reds the build.
- Future enhancement (not done here, to avoid destabilizing the lint run in this PR):
  upgrade `eslint-plugin-react-hooks` to v6 for the in-editor `react-hooks/react-compiler`
  rule, which works without the broken `zod@3`-bound `eslint-plugin-react-compiler`.
- **Corrects ADR 0006**, which stated the sweep "kept every `React.memo` wrapper
  (57)." That held for passes 2–3 (`b797d47f`, `8bd4f743`), but pass 1 (`584186b4`)
  had already stripped 20 before the keep-wrappers policy was adopted; this ADR
  restores them.
