# Survey: settings, onboarding, theme, navigation, route tree, boot gates

Area: `app/features/settings`, `app/features/onboarding`, `app/features/theme`, `app/navigation`,
`app/app` (root layout, route groups, `+native-intent`, `+not-found`), `app/shared/lib/nav`,
`app/shared/lib/legal`, `app/shared/lib/theme`, `themeEngine.ts`, `wallpaperStorage.ts`,
`wallpaperSync.ts`, `downloadedThemeRegistry.ts`, `url.ts`, `version.ts`. To follow startup and
gates I also read files just outside the area: `shared/blocks/AppGate.tsx`,
`shared/providers/AccountProviders.tsx`, `InitializationProvider.tsx`, `GlobalMigrationGate.tsx`,
`ThemeProvider.tsx`, `settingsStore.ts`, `wallpaperStore.ts` (download/integrity parts),
`SlideToConfirm.tsx`, `ActionMenuHost.tsx` (primary action), `deleteAllProfiles`.

Read only. No tests were run. Paths are relative to `app/` unless they start with `wallet/`.

## Boot order as the route tree sees it

`app/_layout.tsx` `RootLayout`:

1. Module load: `SplashScreen.preventAutoHideAsync`, `loadSettledHeaderHeights`,
   `applyFeatureSetToWallet`, `preloadNfcSupported`.
2. Renders `null` until fonts load or fail (`_layout.tsx:315`).
3. `E2EStateMirror`, then `OuterProviders` in this order: Keyboard, Initialization, Theme
   (renders `null` until `wallpaperStore._hasHydrated`, `ThemeProvider.tsx:155`), Capability,
   LayoutGuides, TouchIndicator, HeroUI, HeroTransition, OfflineStatus.
4. `TransitionControlRegistrar`, `TransitionGuardCleanup` (clears the AsyncStorage transition
   guard; reports storage use after 60 s).
5. `NativeSplashLayoutGate` → `GlobalMigrationGate` (stage `global-migrations`,
   `outlivesAccount`; runs `migrateThenLoad`, opens the profile-scoped storage gate only on
   success, otherwise `StartupFailedScreen`).
6. `AccountSwitchBoundary` (can hold the tree unmounted during an in-process switch) →
   `AccountScopedProviders key="account-<activeAccountIndex>"`. A change of active account
   remounts everything below.
7. Inside that, in compose order: NostrKeys → NostrNDK → NostrSigner → Whitenoise → Coco →
   WalletContext → SovranColada (holds `Linking.useURL()` deep-link handling) → Pricelist →
   [BitchatBLE] → [DmEcashAutoRedeem] → **AppGate** → `RootLayoutContent` (the `Stack`, the
   feature route guard, payment/swap listeners, own-events sync).
8. AppGate order (`shared/blocks/AppGate.tsx:128-215`): secure store locked → KeyRecovery;
   keys error and not ready → KeyRecovery(unlocked); settings hydration `loading` → null,
   `error` → retry screen; legal acceptance not current → Terms (2 steps); reinstall check
   pending → null; onboarding not seen → carousel, or if reinstall detected →
   `completeOnboarding()` **during render** and fall through; keys loading → null;
   `RestoreGate` (`AppGate.tsx:252-320`): waits for lifecycle hydration and its own evaluation,
   then `pending`/`failed` → `SettingsRecoveryScreen gateMode`, else children.

Things to keep in mind:
- The `Stack` and `useFeatureRouteGuard` mount only after AppGate passes. Every listener in
  `RootLayoutContent` is therefore gated too, but the providers above AppGate (Coco, Colada's
  `Linking.useURL`, DM auto-redeem) run **before terms acceptance and before the restore
  gate**. Colada only starts deep links when `keys?.pubkey` is set
  (`features/send/providers/Colada.tsx:624-635`). On a fresh install keys are created alongside
  the Terms gate, so a `cashu:` / `lightning:` launch URL can reach Colada while Terms or the
  restore gate is showing and the Stack is not mounted. UNVERIFIED: I did not follow what Colada
  does with a router push when no Stack is mounted. This ordering should be pinned before
  anyone moves AppGate.
- `useInitializationStage` registers once per component instance (`hasRegistered` ref). A
  reset that does not keep `outlivesAccount` stages leaves `global-migrations` unregistered
  forever. That is only safe because such a reset is followed by a runtime restart.
  `initializationStagesAcrossSwitch.test.tsx` pins this.

## 1–2. Boundaries and whether they are pinned

Legend: **P** pinned by a behaviour test · **p** partly pinned · **N** none · **I** only
internals or a copy of the logic.

| # | Boundary | File | Used by | Pinned |
|---|---|---|---|---|
| 1 | AppGate full order (locked → error → hydration → terms → reinstall → onboarding → keys → restore) | `shared/blocks/AppGate.tsx:128` | `AccountProviders.tsx:79` | **p**: only the `locked` branch is rendered (`__tests__/appGateReinstallDetection.test.tsx:144-185`). Nothing renders AppGate with locked=false to check the order of terms, onboarding, keys and restore |
| 2 | `useReinstallDetection` | `AppGate.tsx:39` | AppGate | **P** `appGateReinstallDetection.test.tsx:75-113` (fresh-install race, reinstall, no seed, skip probe) |
| 3 | `RestoreGate` / `evaluateRestoreStatus` (writes persisted `restoreStatus`) | `AppGate.tsx:224-320` | AppGate | **I** `restoreGateStatusResolution.test.ts` re-declares `blocksApp`/`skipsReevaluation` locally and never imports AppGate. Changing AppGate cannot fail it. The writes (`pending`/`not-needed`, `markSeedCreatedNow`+`markRestoreComplete` on Continue) have no test |
| 4 | `TermsAndConditionsScreen` (two-step accept, back, settings-error retry, view recovery) | `features/onboarding/screens/TermsAndConditionsScreen.tsx` | AppGate, design system | **P** `legalAgreementScreen.test.tsx` (store mocked through a selector, which is fine); `onboardingTermsSelectors.test.ts` |
| 5 | Legal revision hash and `hasCurrentLegalAcceptance` | `shared/lib/legal/legalDocuments.ts` | settingsStore, AppGate, notifications | **P** `legalDocuments.test.ts`; `settingsStorePersistResilience.test.ts:253` (legacy reprompt keeps the original date) |
| 6 | Persisted `termsAccepted` / `legalAcceptance` / `hasSeenOnboarding` (AsyncStorage `settings-store` v4) | `shared/stores/global/settingsStore.ts:396-416, 486-525` | AppGate, Terms, Notifications | **P** `settingsStorePersistResilience.test.ts:152-372`, `releaseFixtures`, `persistSchemaDrift` |
| 7 | `OnboardingScreen` (Next/Back/Get Started, recovery phrase entry) | `features/onboarding/components/OnboardingScreen.tsx` | AppGate | **N** at unit level; native story `e2e/stories/library/first-launch-accept-terms.json` only |
| 8 | `redirectSystemPath` / `rewriteSystemPath` (nostrconnect → ticket) | `app/+native-intent.tsx` | expo-router | **P** `nip46PairingEntry.test.ts:59-125` |
| 9 | Payment-scheme URLs (`cashu`, `lightning`, `bitcoin`, `lnurl*`, `nostr`, `sovran`) passing unchanged through the route tree (`app.json` scheme list) | `+native-intent.tsx:28`, `+not-found.tsx`, Colada | OS | **N**: no test says which route these resolve to or that `NotFoundScreen` is not shown over a handled payment link |
| 10 | `disabledFeatureForRoute` | `shared/lib/nav/featureRoutes.ts:59` | the guard | **P** `featureSet.test.ts:109-160`, `paymentsEditionBlockedRoutes.test.ts` |
| 11 | `useFeatureRouteGuard` (replace to `/`) | `featureRoutes.ts:80` | `_layout.tsx:158` | **N**: the pure function is pinned, the redirect is not |
| 12 | `NotFoundScreen` / wallet route `/` | `shared/blocks/NotFoundScreen.tsx` | `+not-found` | **P** `notFoundScreen.test.tsx`, `walletRouteResolution.test.tsx` |
| 13 | Route inventory ↔ `CANONICAL_PAGES`/`PAGE_ROUTES`, `MODAL_SCREENS` | `config/modalScreens.ts`, `app/**` | root Stack, e2e | **P** `e2e/audit/page-testability.test.ts`, `e2e/page-journeys.test.ts` |
| 14 | Root provider order and `key=account-<i>` remount | `app/_layout.tsx:294-350` | — | **p** behaviour of the switch: `inProcessProfileSwitch.test.ts`, `profileSwitchOrdering.test.ts`, `initializationStagesAcrossSwitch.test.tsx`. The composition order itself (providers above or below AppGate) is unpinned; `androidPortalFlags`/`reactCompilerGateCoverage` are static scans |
| 15 | `AccountSwitchBoundary` suspend/resume | `shared/providers/AccountProviders.tsx:117` | profile orchestrator | **p** through `inProcessProfileSwitch.test.ts` (outside area; not read in full) |
| 16 | `InitializationProvider` stages / `resetStages` | `shared/providers/InitializationProvider.tsx` | every provider | **P** `initializationStagesAcrossSwitch`, `initializationGateRetry`, `cocoProviderRetry` |
| 17 | `GlobalMigrationGate` | `shared/blocks/GlobalMigrationGate.tsx` | root | **P** `globalMigrationsRunner.test.ts`, `releaseFixtures.test.ts` |
| 18 | `useRouteParams` (Zod at route boundary, back on invalid) | `shared/lib/nav/useRouteParams.ts` | ~15 routes | **P** `useRouteParams.test.tsx` |
| 19 | `routeSchemas` (Npub, HttpsUrl, Hex16, Geohash…) | `shared/lib/nav/routeSchemas.ts` | routes | **P** `routeSchemas.test.ts` |
| 20 | `mintInfoRoutes`, `profileRoutes`, `providerInfoRoutes`, `transactionDetailRoutes` (route param encoders) | `shared/lib/nav/*` | many screens | **P** each has its own `*.test.ts` |
| 21 | Drawer: `drawerMenu`, `drawerGesture`, `tabOrder`, `headerLayout` | `navigation/*` | drawer/tabs layouts | **P** `drawerMenuItems`, `drawerGesture`, `featureSet` (tab order), `headerLayout` |
| 22 | `nativeTabs`, `DrawerContent`, `headerItems`, `headerOptions` | `navigation/*` | layouts | **N** apart from selector/static tests |
| 23 | `SettingsRecoveryScreen` run (NUT-13 restore, trusts/untrusts mints, deletes pending mint ops; gate Continue) | `features/settings/screens/SettingsRecoveryScreen.tsx:203-596` | AppGate (gate), `(settings-flow)/recovery` | **p** `settingsRecoveryGateConfirmation.test.tsx` (10 cases through testIDs; mocks `managerInternals`/Coco but asserts observable results). Unpinned: the timeout path, the no-mints early return, untrusting probed misses, deleting pending ops, `beforeRemove` lock |
| 24 | `recoveryProgress` reducer helpers | `features/settings/lib/recoveryProgress.ts` | recovery screen | **P** `recoveryProgress.test.ts` |
| 25 | `fetchDiscoveredMintUrls` / `isAllowedMintHost` (HTTP discovery is untrusted) | `features/settings/lib/recoveryDiscovery.ts` | recovery | **P** `recoveryDiscovery.test.ts` |
| 26 | `readRecoveryInformation` (reads SecureStore, never writes) | `features/settings/lib/readRecoveryInformation.ts` | `SettingsProfileRecoveryScreen` | **P** `legalRecoveryInformation.test.ts`, `legalRecoveryScreen.test.tsx`, `accountMismatchScreen.test.tsx` |
| 27 | `DeleteScreen` → `deleteAllProfiles` (wipes everything) | `features/settings/screens/DeleteScreen.tsx` | `(settings-flow)/delete` | **N** |
| 28 | `SettingsKeyringScreen` (Coco keyring generate/import/add current nsec) | `features/settings/screens/SettingsKeyringScreen.tsx:258-400` | `(settings-flow)/keyring` | **N** (only `capturePageSelectors`) |
| 29 | `SettingsEditProfileScreen` (publishes kind 0) | `features/settings/screens/SettingsEditProfileScreen.tsx` | `(settings-flow)/edit-profile` | **P** `settingsEditProfile.test.tsx` (contents not read in full) |
| 30 | `SettingsScreen` (dev-mode triple tap, DB export, links) | `features/settings/screens/SettingsScreen.tsx` | `(settings-flow)/index` | **p** `settingsScreen.test.tsx` checks layout only; triple-tap → `experimental` write is unpinned |
| 31 | Network / Routing / Media / Moderation / NotificationPolicy / Storage screens (write settingsStore, middleman routing, media server, moderation lists) | `features/settings/screens/*` | settings-flow | **N** (selectors only) |
| 32 | `ClaimUsernameScreen` claim (npub.cash `setUsername`, signed with nsec) | `features/onboarding/screens/ClaimUsernameScreen.tsx:331-543` | `app/claimUsername.tsx` | **N** for the claim; `npcHost.test.ts` pins only the host and SDK version |
| 33 | `useThemeDraft` (begin/setAlbum/commit/discard/isDirty → writes profile `themeStore`, starts downloads) | `features/theme/lib/themeDraft.ts` | Theme preview, background, gallery | **p** `themeDraftAlbumDistribute.test.ts` (setAlbum only). `commit` is unpinned |
| 34 | `ThemeProvider` resolve and apply CSS vars | `shared/providers/ThemeProvider.tsx` | root | **N** |
| 35 | `resolveUnitWallpaper` / `getCatalogThemesForAlbum` | `shared/lib/theme/resolveUnitWallpaper.ts` | ThemeProvider, draft | **P** `resolveUnitWallpaper.test.ts` |
| 36 | `downloadWallpaper`, `publishWallpaper`, `cleanupOrphanedFiles` (files under `documentDirectory/wallpapers/`) | `shared/lib/wallpaperStorage.ts` | wallpaperStore | **P** `wallpaperStorage.test.ts` (5 cases) |
| 37 | `refreshCatalog` (HTTP `/app/wallpapers`, author filter, shade check) | `shared/lib/wallpaperSync.ts` | gallery | **p** `wallpaperBtcMap.test.ts:98-158` (fetch, new fields, missing shade). The non-Sovran-author filter and the orphan-slug rule are unpinned |
| 38 | `registerDownloadedTheme` / `unregisterDownloadedTheme` (mutates THEMES etc.) | `shared/lib/downloadedThemeRegistry.ts` | wallpaperStore | **N** directly |
| 39 | `themeEngine` (`getThemeVariables`, `themeVariables`, static tokens) | `shared/lib/themeEngine.ts` | everywhere | **P** `themeTokens.test.ts` |
| 40 | `wallpaperMotion`, `themeTransition` | `shared/lib/theme/*` | wallpaper layers | **P** `wallpaperMotion.test.ts`, `wallpaperCarousel.test.ts` |
| 41 | `url.ts` (`validateExternalUrl`, `openExternalUrl`, `normalizeMintUrlKey`, `normalizeUrlForApi`, `isHttpNavigationUrl`, `isLikelyHttpUrl`) | `shared/lib/url.ts` | mint cache keys, external links | **P** `openExternalUrl`, `urlCaseNormalization`, `isHttpNavigationUrl` tests |
| 42 | `version.ts` (`supportsBlur`, `supportsLiquidGlass`) | `shared/lib/version.ts` | capability provider | **N** (imported by UI tests only) |

Tally: 42 boundaries. 24 pinned (P), 8 partly pinned (p), 1 pinned only by a copy of its logic
(I, #3), 9 with no test (N).

## 3. Likely surgery targets

1. **AppGate + RestoreGate state machine.** `shared/blocks/AppGate.tsx:128-320`. The phase is
   encoded jointly by `secureStoreState`, `{isReady,isLoading,error}` from NostrKeys,
   `settingsHydration.status`, `legalAcceptance` (as revisions), `hasSeenOnboarding`,
   `reinstallState` (`checking|none|detected`), RestoreGate's `hydrated`, local `evaluated`,
   persisted `restoreStatus` (6 values, 'in-progress' stranded), and `seedCreatedAt`. A side
   effect runs in render (`completeOnboarding()` at `:186`). Pinned: `locked` branch and the
   reinstall hook. Unpinned: everything else, including the writes to persisted
   `restoreStatus`. The current restore test mirrors the logic and does not import AppGate (#3).
2. **SettingsRecoveryScreen run.** `SettingsRecoveryScreen.tsx:145-596`. Phase `idle|discovering|restoring|finalizing|complete|error`,
   plus module globals `recoveryInFlight`/`recoveryCancelled`, `isDiscovering`, `deepProbe`,
   `errorMessage`, `finalizingLabel`, the `results` array, and the non-resetting
   `SlideToConfirm`. A 450-line handler mixes probing, restoring, untrusting, op deletion and
   popups. Pinned: Continue gating, cancel, keyset outcomes, single-flight. Unpinned:
   timeout, no-mints early return, untrust list, pending-op deletion, `gateMode` hiding popups.
3. **TermsAndConditionsScreen step machine.** `TermsAndConditionsScreen.tsx:34-41`. `step`,
   `isChecked`, `privacyChecked`, `showRecovery`, `settingsError` prop. Pinned well.
4. **Legal acceptance kept in two fields.** `settingsStore.ts:85-86, 396-410`: `termsAccepted`
   (legacy, kept as the notification history boundary) and `legalAcceptance` (revisions).
   `isTermsAccepted()` (`:410`) still reads the legacy field, while AppGate uses
   `hasCurrentLegalAcceptance(legalAcceptance)`. These are two answers to "accepted?". grep finds
   no callers of `isTermsAccepted()` outside the store. Pinned for persistence; whether
   `isTermsAccepted` is dead is not.
5. **ThemeDraft commit ↔ wallpaperStore ↔ ThemeProvider.** `themeDraft.ts:189-237`,
   `ThemeProvider.tsx:78-150`. Effect chain: the draft writes themeStore, ThemeProvider bails
   when THEMES lacks the name and has no dependency on registration. Unpinned (see defect D3).
6. **Mutable global theme registries.** `downloadedThemeRegistry.ts` mutates `THEMES`,
   `themeVariables`, `BACKGROUND_THEME_NAMES` and four maps in place. `wallpaperStore` registers
   from three places (`:181`, `:232`, `:314`). This is a parallel registry with no test.
7. **Mint-URL normalisers in parallel.** `url.ts:86` `normalizeMintUrlKey` (no scheme),
   `url.ts:174` `normalizeUrlForApi` (forces https), `recoveryDiscovery.ts:17` private
   `normalizeMintUrl` (lowercases the whole URL including the path), plus coco's own. Each one
   is pinned separately; nothing pins that they agree.
8. **Keyring screen impl functions.** `SettingsKeyringScreen.tsx:250-400`. Four `*Impl`
   functions take wide `io` bags of setters (`setIsLoading`, `setLoadSucceeded`,
   `setKeypairs`, `setIsGenerating`…). The interface is as wide as the implementation. Unpinned
   (see D4).
9. **DeleteScreen** is a thin wrapper over `deleteAllProfiles` that drops its result (D1).
   `KeyRecoveryScreen.tsx:91` does the same job correctly with `setFailed(!(await …))`.
10. **`useFeatureRouteGuard` runs inside AppGate.** `_layout.tsx:158`. With route guard, deep
    links and the gate spread across three layers, a later pass moving the gate would want
    #9/#11 pinned first.

## 4. Obvious defects

**D1. Delete Account reports success and freezes when deletion is refused.**
`features/settings/screens/DeleteScreen.tsx:22-26`. `deleteAllProfiles()` returns `false`
without erasing anything when another profile transition holds the lock
(`profileSessionOrchestrator.ts:594-595`), when the disk guard cannot be taken (`:596-599`),
or on a failure before the first deletion (`:672-674`). DeleteScreen ignores the result,
logs `settings.delete.complete`, and shows nothing. `SlideToConfirm` sets `confirmed`/
`isComplete` and never resets (`shared/ui/composed/SlideToConfirm.tsx:52-57,77`), so the thumb
stays at the end and the slider will not fire again. To retry, the person has to leave the page
and come back. Expected: on `false`, say the account was not deleted and re-arm the slider, as
`KeyRecoveryScreen.tsx:91` does. Fix touches no stored data. Verified end to end.

**D2. A recovery mint that times out keeps restoring after its row says "Timed out", and the
single-run guard is released while it runs.** `SettingsRecoveryScreen.tsx:447-469, 589-591`.
`withTimeout` (`wallet/src/safeFetch.ts:157-185`) only races the promise; it cancels nothing.
After 120 s the loop marks the mint `failed` and moves to the next mint, while the old
`restoreOneUrl` keeps walking keysets (it checks only `recoveryCancelled`), so two mints now
restore at once. That is the contention the "ONE MINT AT A TIME" comment (`:430-441`) was
written to stop. When the run ends, `finally` clears `recoveryInFlight` with the orphan still
running. "Reswipe to try again" can then start a second restore against the same wallet, which
the module comment (`:76-85`) says "races counters". The orphan's later `patch(i, …)`
(`:411-419`) also rewrites the row from `failed` to `done` after the run's summary and phase
are decided. Expected: keep the run in flight (or block a retry) until every started
`restoreOneUrl` settles, and ignore late patches. Fix touches no stored data, but the race it
prevents can push Coco's derivation counters (wallet DB) out of step. Verified by reading the
code; not reproduced.

**D3. Theme Apply writes a wallpaper whose download failed, and the chrome never picks it
up.** `features/theme/lib/themeDraft.ts:200-213`. `wallpaperStore.downloadWallpaper` catches
every error and returns `false` (`shared/stores/global/wallpaperStore.ts:200-214`). `commit`
ignores that and writes `unitWallpapers`/`activeAlbumSlug` to the persisted profile
`themeStore` anyway. The primary is also skipped in the background-download loop (`:219`), so
nothing retries it. `ThemePreviewScreen.handleApply` (`ThemePreviewScreen.tsx:125-129`) then
goes back as if it worked. ThemeProvider's effect returns early on `theme.not_found`
(`ThemeProvider.tsx:79-82`) and depends only on `[resolvedTheme, activeUnit, accountIndex]`,
so the chrome stays on the old palette. This is the state the comment at `themeDraft.ts:194-199`
says the await exists to prevent. Expected: if the primary download fails, do not commit, tell
the person, and stay on the preview. The fix changes whether a persisted themeStore write
happens, not its shape. Verified end to end.

**D4. An invalid key in Keyring "Import Private Key" closes the sheet without showing the
error.** `features/settings/screens/SettingsKeyringScreen.tsx:325-342`. On invalid input the
function calls `io.setError('Enter nsec or 64-character hex key.')` and returns, but `finally`
always runs `io.finalize(); io.close();`. `close` marks the menu as selected and closes it
(`shared/blocks/popup/ActionMenuHost.tsx:68-73`). The error is set on a sheet that is already
closing. Nothing is imported and no popup appears. Expected: keep the sheet open with the error
on invalid input, and close only on success or a thrown failure. No stored data. Verified by
reading the code.

**D5. Gate-mode recovery has no way forward when every known mint is "skipped".**
`SettingsRecoveryScreen.tsx:401-410, 560-571, 727, 816-841`. If all of a mint's keysets fail
`isRestorableKeysetId`, it becomes `skipped`. With no failures the run reaches `complete`, but
`canContinue = successMintCount > 0 || counts.total === 0` is false. In gate mode the complete
view shows only a disabled Continue: no retry slider and no cancel. The person cannot reach the
app. On relaunch `restoreStatus` is still `pending`, and the same mints give the same result.
`settingsRecoveryGateConfirmation.test.tsx:224-242` pins the disabled Continue (keep it as a
QUIRK) but not the missing exit. Requires every known mint to serve only legacy keyset IDs. The
default mints added in the background by `CocoProvider` usually prevent this, so it is rare.
Expected: offer retry, or "Search all mints", from that state. No stored data. Verified as far
as the rendered controls go.

**D6. Recovery slider stays spent after the "No mints found" early return.**
`SettingsRecoveryScreen.tsx:222-227`. The function returns after a popup, phase stays
`idle`/`error`, and the `SlideToConfirm` instance remains completed (see D1), so swiping again
does nothing. The only ways to re-arm it are toggling "Search all mints" (which unmounts the
slider through `isDiscovering`) or leaving the page. In gate mode leaving is not possible, so
the toggle is the only exit. No stored data. Verified.

Not defects, but noted:
- `useFeatureRouteGuard` re-fires `router.replace('/')` on every `segments` identity change
  while the route is blocked (effect deps include the `segments` array). Probably harmless.
  UNVERIFIED.
- `getWallpaperUri(themeName)` (`wallpaperStorage.ts:197`) puts a catalog-supplied `themeName`
  into a file path. The schema allows any string up to 64 characters (`@sovranbitcoin/schemas
  src/theme.ts:44`; the blossom schema has a slug regex, the catalog does not). Wallpapers in an
  album slug that matches no album, or with no author, survive the Sovran-author filter
  (`wallpaperSync.ts:60-63`). A `../` name would write outside `wallpapers/`. The catalog is
  first-party, so this is reported only. A fix would touch the wire schema in `sovran-schemas`.
- Misplaced doc comments in `url.ts:157-166` and `:228-234`: each sits above the wrong function.
- `restoredSomething` (`SettingsRecoveryScreen.tsx:402`) labels a mint `already-recovered` when
  any keyset was already present, even if others restored new proofs. Both count as success,
  so it is a label QUIRK only.

## 5. Proposed characterization tests (ranked)

1. **AppGate order, rendered.** `app/__tests__/appGateOrder.test.tsx`. Use the real
   `settingsStore` / `walletLifecycleStore` (in-memory AsyncStorage) and stub only NostrKeys,
   `retrieveMnemonic` and the leaf screens (testID stubs). Pin: hydration `loading` → nothing;
   `error` → settings-error page with retry that sets `loading` and calls `rehydrate`; legacy
   `termsAccepted` without `legalAcceptance` → Terms with "Updated documents"; Terms before
   onboarding; reinstall `detected` writes `hasSeenOnboarding=true` and skips the carousel
   (QUIRK: written during render); keys not ready → nothing; `restoreStatus` `unknown`+seed+no
   `seedCreatedAt` → writes `pending` and shows the recovery gate; `seedCreatedAt` set → writes
   `not-needed`; stranded `in-progress` → re-evaluated; Continue → `seedCreatedAt` set and
   `complete`. Delete `restoreGateStatusResolution.test.ts` or replace it. Broken variant that
   should fail: swap the terms and onboarding branches, or add `'in-progress'` to the blocking
   set.
2. **Recovery timeout and orphan.** Extend `settingsRecoveryGateConfirmation.test.tsx`. Use fake
   timers; `restoreKeysetForMint` hangs for mint A. Pin: A shows "Timed out"; mint B starts;
   today's behaviour (QUIRK) that a second swipe is accepted while A's restore is still pending,
   and that A's late resolve flips the row. Once D2 is fixed, assert the opposite. Broken
   variant: drop the `withTimeout` wrapper, and B never starts.
3. **DeleteScreen result handling.** `app/__tests__/deleteScreen.test.tsx`. Mock
   `deleteAllProfiles` → `false` / reject / `true`. Pin today's (D1) behaviour: no message, log
   says complete. Then pin the fixed behaviour. Broken variant: call `deleteAllProfiles` twice,
   or not at all.
4. **Theme draft commit.** `app/__tests__/themeDraftCommit.test.ts`. Use the real themeStore
   and wallpaperStore with `downloadWallpaperFile` mocked. Pin: success awaits the primary
   before the themeStore write, enqueues the others once each, skips ones already downloaded,
   and resets the draft. Failure: today themeStore is still written (D3, QUIRK until fixed).
   Broken variant: write themeStore before the await.
5. **Payment deep link through the route tree.** `app/__tests__/paymentDeepLinkRouting.test.tsx`
   with expo-router's `renderRouter`. Pin what `cashu:cashuB…`, `lightning:lnbc…`,
   `bitcoin:bc1…` and `sovran://…` resolve to after `redirectSystemPath` (expected: not
   `+not-found`, or `+not-found` documented as a QUIRK), and that none puts the token into
   route params. Broken variant: make `rewriteSystemPath` return `/receiveToken?token=…`.
6. **Keyring import.** `app/__tests__/keyringImport.test.tsx`. Mock `useManager` keyring. Pin:
   valid nsec/hex → `addKeyPair` once and the list reloads; invalid → no `addKeyPair` (today the
   sheet also closes and the error is lost, D4 QUIRK); double tap → one write
   (`useSingleFlight`); "add current key" when already present → no write. Broken variant:
   remove `useSingleFlight`.
7. **Feature route guard hook.** Extend `featureSet.test.ts` with a rendered hook (mock
   `useSegments`). Pin: blocked segments → `router.replace('/')` once and a warn log; exempt
   groups (`(settings-flow)`, `(transactions-flow)`) never redirect. Broken variant: drop the
   exempt-group check.
8. **refreshCatalog author filter.** Extend `wallpaperBtcMap.test.ts`. Pin: an album by another
   pubkey and its wallpapers are dropped; an uppercase Sovran pubkey is kept; a wallpaper with
   an orphan slug is kept (QUIRK); a failed fetch leaves the catalog untouched and returns
   `false`. Broken variant: compare pubkeys case-sensitively.

## 6. Not examined

- The design-system folder (`features/settings/design-system/**`, the `SettingsDesignSystem*`
  screens, `designSystemTimelineScenarios.ts`). These are preview-only and covered by snapshot
  tests I did not read.
- `SettingsNetworkScreen`, `SettingsRoutingScreen`, `SettingsMediaScreen`,
  `SettingsModerationScreen`, `SettingsStorageScreen`, `SettingsNotificationPolicyScreen`,
  `SettingsEditProfileScreen`, `ProfileDetailsScreen`, `SettingsProfileRecoveryScreen`: only
  grepped for writes; not read line by line.
- `features/theme/screens/*` other than the Apply handler, `useAlbumList`, `UnitPreviewCard`,
  `WallpaperThumbnail`, `AlbumPillTabs`; `shared/lib/theme/builtinAlbums.ts`,
  `wallpaperRenderState.ts`, `themeTransition.ts` internals.
- `navigation/nativeTabs.tsx`, `DrawerContent.tsx`, `headerItems.tsx`, `headerOptions.ts`, and
  all route-group `_layout.tsx` files other than root, drawer and settings-flow.
- `NativeSplashLayoutGate.tsx` (572 lines), `InitializationGate`, `KeyRecoveryScreen`,
  `profileSessionOrchestrator` beyond `deleteAllProfiles`, Colada's deep-link scan handler, and
  `ClaimUsernameScreen` UI below line 580.
- I ran no tests, so "pinned" means a test exists and its names and assertions match. I did not
  check that it passes today.
