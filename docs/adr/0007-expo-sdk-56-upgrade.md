# 7. Expo SDK 56 / React Native 0.85 upgrade

Date: 2026-06-27
Status: Accepted

## Context

The app was on Expo SDK 55 / React Native 0.83.2. SDK 56 ships React Native
0.85.3 (Hermes v1 default, legacy bridge fully removed → New Architecture only),
React 19.2.3, and a set of breaking changes. The headline one for this app:
`expo-router` no longer depends on `react-navigation`, so app code may not import
from `@react-navigation/*` directly, and `expo-router` now bundles its own
**fork** of the react-navigation source.

## Decision

Upgrade to SDK 56 in a single branch (`chore/expo-sdk-56`), validated against the
in-repo gates (type-check, lint, jest, expo-doctor, Metro bundle, prebuild config
dry-run). The native build + on-device pass is owned by the release engineer.

### React Navigation → Expo Router
- Ran `expo-codemod sdk-56-expo-router-react-navigation-replace` over the source.
  22 import sites moved automatically to `expo-router/react-navigation`,
  `expo-router/js-tabs`, etc.
- The codemod cannot map `@react-navigation/native-stack` and
  `@react-navigation/drawer`. Resolved manually:
  - **native-stack types** (`NativeStackNavigationOptions`, `NativeStackHeaderProps`)
    are re-exported from the main `expo-router` entry → import from `'expo-router'`.
  - **drawer hooks/types** (`useDrawerStatus`, `useDrawerProgress`,
    `DrawerContentComponentProps`) are re-exported from `expo-router/drawer`.
- Removed the 5 `@react-navigation/*` direct dependencies (now transitive under
  expo-router). The two that are patched still hoist to top-level `node_modules`,
  so patch-package continues to reach them.

### Patches re-targeted to expo-router's react-navigation fork
Because expo-router 56 forked react-navigation, patches against
`node_modules/@react-navigation/*` no longer affect the navigators the app
renders. Therefore:
- **drawer `overlayStyle`** (custom rounded-scrim option): re-targeted to
  expo-router's forked `DrawerView.js` + `types.d.ts`
  (`patches/expo-router+56.2.11.patch`). The fork hardcoded the overlay style; the
  patch threads the per-screen `overlayStyle` option through and adds it to
  `DrawerNavigationOptions`.
- **native-stack `hidesSharedBackground`** (iOS 26 liquid-glass double-chrome
  workaround for custom `headerLeft`/`headerRight`): the patch was dropped, and
  device testing confirmed the regression (doubled glass + swallowed taps). The
  correct SDK 56 replacement is **not a patch** — see the addendum below.
- The `expo-router+55.0.12.patch` native-tabs crash bridge is **obsolete** —
  SDK 56 rewrote `NativeTabsView`; deleted.
- `react-native-screens` (4.25.2, unchanged in SDK 56), `@gorhom/bottom-sheet`
  (regenerated for 5.2.14), `heroui-native` (regenerated for 1.0.4), and the
  scripted `cashu-kym` patch are retained.

### API / style deltas
- `StyleSheet.absoluteFillObject` was removed in RN 0.85 → swept 81 sites to
  `StyleSheet.absoluteFill` (an identical frozen object, safe for direct + spread).
- `expo-file-system` `File.move()` is now async → `loggerFile.rotateIfNeeded`
  (sync) uses `moveSync()`.
- `expo-status-bar` dropped the Android-only `backgroundColor` prop.
- `@expo/ui` `TextField` replaced `defaultValue`/`onValueChange` with
  `text`/`onTextChange`; `LiquidChatComposer` keeps its uncontrolled+reset pattern
  and seeds the field imperatively via `ref.setText()`.
- babel: removed the explicit `react-native-reanimated/plugin` — `babel-preset-expo`
  auto-includes `react-native-worklets/plugin` in SDK 56.

### Jest (RN 0.85 under jest-expo/node)
- Added `standard-navigation` (new expo-router dep) to `transformIgnorePatterns`.
- RN 0.85 eagerly resolves native modules when a component is required, which the
  `jest-expo/node` preset doesn't mock. Added React Native's own jest setup
  (`@react-native/jest-preset/jest/setup.js`) on top of the preset's setupFiles.
- Two tests that `requireActual('react-native').Text` (→ Pressability →
  `Platform.OS`, which throws under node) now use the mocked `Text` via
  `requireMock`.

### Deliberate version holds (recorded in `expo.install.exclude`)
- **typescript 5.9.3** — SDK 56's TS 6.0.3 is opt-out; deferred (separate, risky).
- **jest 30 / @types/jest 30** — pre-existing intentional ahead-pin; tests pass.
- **react-native-quick-crypto 1.1.0** — held; 1.1.5 drags a `react-native-quick-base64`
  3.x peer the lockfile doesn't satisfy.
- **react-native-keyboard-controller 1.21.12** — hygiene bump (ahead of bundle).

## Consequences
- The app is New-Architecture-only and Hermes-v1 by default; minimum iOS 16.4,
  Xcode 26.4 (EAS default image already provides it; local builds require it for
  the liquid-glass modules).
- Device QA must confirm: iOS 26 custom-header chrome (dropped native-stack patch),
  the drawer rounded scrim, the chat composer text seed/reset, and the heavy
  native modules (skia 2.6.2, reanimated 4.3.1 + worklets 0.8.3, view-shot 5,
  quick-crypto, bitchat, liquid-glass).

## Addendum (2026-06-27): iOS 26 header items + glass-touch fixes

Device testing surfaced three regressions; all fixed on the same branch.

1. **Header buttons: doubled glass + intermittent taps.** Custom header buttons
   (`HeaderGlassCircle`, via `@expo/ui` glass) were passed through the legacy
   `headerLeft`/`headerRight` functions. On iOS 26, react-native-screens wraps
   those slots in the system Liquid Glass shared-background capsule — on by
   default, undisableable via the legacy form, and it intercepts touches. Result:
   the app glass + system capsule both render, and `onPress` fires unreliably.
   **Fix:** a shared helper `navigation/headerItems.tsx::withGlassHeaderItems`
   mirrors `headerLeft`/`headerRight` into the SDK 56 (iOS, `unstable_`)
   `unstable_headerLeftItems`/`unstable_headerRightItems` API as
   `{ type: 'custom', element, hidesSharedBackground: true }`. This suppresses the
   system capsule (single glass) and removes the intercepting container (taps
   land). Android keeps the legacy `headerLeft`/`headerRight` (the items API is
   iOS-only). Applied via the two header builders
   (`buildExpoRouterHeaderOptions`, `createFlowLayoutScreenOptions`) plus the
   per-screen header sites. The API is `unstable_`/alpha — accepted risk.

2. **Send/Receive open inconsistently.** `CapsuleButton.liquid.tsx` wrapped a
   `PressableFeedback` in an `expo-glass-effect` `<GlassView isInteractive>`; the
   interactive glass layer contended with the pressable for touches. **Fix:**
   dropped `isInteractive` so the glass is decorative and the pressable owns the
   tap.

3. **Wallet QR button intermittently missing.** Its opacity was gated solely by
   the boot-morph completion flag (`useBootMorphCompleted`); a racing/timed-out
   anchor poll left it at opacity 0. **Fix:** a fail-safe in `QRButton.ios.tsx`
   and `QRButton.android.tsx` reveals the button ~1.5s after mount if the morph
   hasn't completed (the morph stays a visual enhancement, not a gate), with a
   `QRButton` boot log.

### eslint-config-expo held at ~55
The SDK-56 hygiene bump of `eslint-config-expo` to ~56 pulled
`eslint-plugin-react-hooks@7` (React-Compiler-era rules), which (a) imports
`zod-validation-error/v4` while allowing a 3.x that lacks it, breaking config
load, and (b) flags ~500 pre-existing violations across the app. As that is a
dev-only lint config not required by SDK 56, it is **held at ~55**
(`expo.install.exclude`). Adopting `eslint-config-expo@56` + the React Compiler
hook rules is a deliberate separate follow-up.
