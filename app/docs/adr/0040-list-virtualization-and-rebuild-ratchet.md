# 0040 — List Virtualization Audit and First-Principles Rebuild Ratchet

Status: accepted
Date: 2026-11-25

## Context

During the first-principles rebuild audit (Wave 0), we evaluated whether replacing
`@shopify/flash-list@2.3.2` with `@legendapp/list` would improve scroll smoothness
or reduce content shifts, and established an automated metrics ratchet to keep
dependency count, runtime LOC, flow groups, and legacy library footprints
monotonically decreasing across Waves 0–6.

A review of every virtualized list call site in `app/` (`shared/ui/composed/List.tsx`,
`shared/ui/composed/SectionAnchorList.tsx`, `features/transactions/components/Transactions.tsx`,
`shared/ui/composed/chat/ChatScreen.tsx`) alongside [ADR 0005](0005-flashlist-v2-list-migration.md)
confirmed:

1. **Sovran already migrated away from `@legendapp/list@3.0.6` to FlashList v2** in
   ADR 0005 specifically because LegendList's asynchronous `estimatedItemSize` → measure
   cycle produced visible layout shifts that required extensive workaround scaffolding
   (two-list crossfades, counter-scrolls, fixed-height skeletons).
2. **FlashList v2 measures synchronously under Fabric (RN 0.85)** and powers the
   existing `<List>` seam, `SectionAnchorList`, `ChatScreen`, and `Transactions`.
3. **Observed jank and settle flicker on the Transactions timeline come from item
   granularity and state architecture, not the virtualizer engine:**
   - `Transactions.tsx` renders entire month/day groups as coarse `Section` items
     without `getItemType` separation, and hides the list behind an opacity-masked
     `settleOverlay` until layout settles.
   - Rows subscribe directly to multiple stores instead of receiving immutable
     `ViewState<T>` snapshots from a single headless `AppRuntime` projection.

## Decision

1. **Keep `@shopify/flash-list@2.3.2` as the single virtualized list engine.** Do not
   re-introduce `@legendapp/list`. Fix timeline smoothness and content shifts at the
   source in Waves 4 and 6 (single-source projections, `ViewState<T>` exhaustive
   rendering, and row-level stability).
2. **Enforce the Wave 0 metrics ratchet via `bun run rebuild:metrics`.**
   [scripts/rebuild-metrics.mjs](../../../scripts/rebuild-metrics.mjs) compares live
   workspace counts against [docs/architecture/rebuild-baseline.json](../../../docs/architecture/rebuild-baseline.json)
   and fails if `appDeps`, `patchedDepsCount`, `flowGroupCount`, `ndkImportFiles`,
   or `herouiImportFiles` regress above the recorded baseline.
3. **Replace `react-native-quick-crypto` and `react-native-nitro-modules` with
   fail-closed `expo-crypto` `getRandomValues`.** Native iOS (`SecRandomCopyBytes`)
   and Android (`java.security.SecureRandom`) CSPRNG is installed in `app/shim.js`
   (explicitly using `getRandomValues`, never `getRandomBytes` which carries a
   `__DEV__` `Math.random` fallback) and probed with 32 bytes at boot, halting startup
   if missing, throwing, or all-zero. Zero retained runtime consumers require
   `crypto.subtle`; `phraseStretch.ts` falls back to `@scure/bip39` `mnemonicToSeedSync`
   (cold-start timing on physical hardware remains tracked under [F93](../../../docs/follow-ups/F93.md)).

## Consequences

- Zero new list-virtualization dependencies; FlashList v2 stays the sole virtualizer.
- `app/package.json` dependency count drops immediately from 94 → 91 (`-react-native-webview`,
  `-network-timeouts`, `-react-native-quick-crypto`, `-react-native-nitro-modules`,
  `+expo-crypto`), removing both the OpenSSL/Nitro C++ binary overhead and dead native
  code.
- Every subsequent wave (Waves 1–6) must pass `bun run rebuild:metrics` alongside
  the full test, upgrade-epoch (`E01`–`E20`), lint, compiler, styling, glass-header,
  knip, and Metro bundle gates.
