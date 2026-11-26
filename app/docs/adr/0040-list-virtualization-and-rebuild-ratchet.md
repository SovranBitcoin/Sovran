# 0040 — List Virtualization Audit and First-Principles Rebuild Ratchet

Status: accepted
Date: 2026-11-25

## Context

During the first-principles rebuild audit (Wave 0), we evaluated whether replacing
`@shopify/flash-list@2.3.2` with `@legendapp/list` would improve scroll smoothness
or reduce content shifts, and established a CI-enforced metrics ratchet to keep
dependency count, runtime LOC, provider nesting, flow groups, and legacy library
footprints monotonically decreasing across Waves 0–6.

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
2. **Enforce the Wave 0 metrics ratchet in CI via `bun run rebuild:metrics`.**
   [scripts/rebuild-metrics.mjs](../../../scripts/rebuild-metrics.mjs) runs in
   `.github/workflows/ci.yml`, compares live runtime counts (`totalRuntimeLoc`,
   `appDeps`, `workspaceDeps`, `patchedDepsCount`, `flowGroupCount`, `providerFiles`,
   `contextDefinitionFiles`, `ndkImportFiles`, `herouiImportFiles`) against
   [docs/architecture/rebuild-baseline.json](../../../docs/architecture/rebuild-baseline.json),
   and fails on any missing baseline key or upward regression.
3. **Replace `react-native-quick-crypto` and `react-native-nitro-modules` with
   fail-closed `expo-crypto` `getRandomValues` + explicit `Buffer`/`process.nextTick`
   globals.**
   - Native iOS (`SecRandomCopyBytes`) and Android (`java.security.SecureRandom`)
     CSPRNG is installed in `app/shim.js` via `expo-crypto`'s `getRandomValues`
     (never `getRandomBytes`, which carries a `__DEV__` `Math.random` fallback),
     guarded against web re-entrancy when Web Crypto is absent, and probed with
     32 bytes at boot, halting startup if missing, throwing, or all-zero.
   - `app/shim.js` explicitly installs `globalThis.Buffer` (from `buffer`, promoted
     to `app/package.json` `dependencies`) and `process.nextTick` so `cashu-ts` and
     `coco-core` retain safe base64 encoding for payloads >32 KiB without falling
     back to chunked `btoa`/`atob`.
   - **Trade-off on `crypto.subtle` (`phraseStretch.ts`):** `phraseStretch.ts`
     (used by `accountIntegrity.ts` on cold start) previously called
     `globalThis.crypto.subtle` PBKDF2-SHA512 opportunistically when `quick-crypto`
     was present. Without `crypto.subtle` on Hermes, cold-start integrity checks
     fall back to `@scure/bip39` `mnemonicToSeedSync` on the JS thread and
     background (`thorough: false`) checks skip wallet-seed cache verification.
     Hardware cold-start timing is tracked under [F93](../../../docs/follow-ups/F93.md);
     if device profiling shows a noticeable launch pause, back `stretchPhraseNative`
     with a minimal native PBKDF2-SHA512 helper (`CommonCrypto` / `SecretKeyFactory`)
     rather than re-adding `react-native-quick-crypto`.

## Consequences

- Zero new list-virtualization dependencies; FlashList v2 stays the sole virtualizer.
- **Unverified in Wave 0 (deferred to Wave 6 device gate):** This Wave 0 decision is
  backed by source audit and ADR 0005's prior LegendList migration evidence; live-device
  Transactions profiling (cold mount, fast fling, live proof/transaction updates on iOS
  and Android hardware) was not run in Wave 0 and is required when Wave 6 flattens
  Timeline rows and migrates to `ViewState<T>`.
- `app/package.json` runtime dependency count drops from 94 → 92 (`-react-native-webview`,
  `-network-timeouts`, `-react-native-quick-crypto`, `-react-native-nitro-modules`,
  `+expo-crypto`, `+buffer` promoted from `devDependencies`), removing the OpenSSL/Nitro
  C++ binary overhead and dead native code while locking the new ceiling in
  `docs/architecture/rebuild-baseline.json`.
- Every subsequent wave (Waves 1–6) must pass `bun run rebuild:metrics` alongside
  the full test, upgrade-epoch (`E01`–`E20`), lint, compiler, styling, glass-header,
  knip, and Metro bundle gates.
