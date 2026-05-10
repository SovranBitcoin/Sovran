const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  // Global ignores — apply to every config below. Listed first because a
  // flat-config block with only `ignores` (no `files`) is treated as a
  // global ignore by ESLint v9.
  {
    ignores: [
      'dist/**',
      // Vendored build output (`@internet-privacy/marmot-ts` is a file-dep
      // pointing at vendor/marmot-ts/dist).
      'vendor/**',
      // Compiled package output. `packages/*/src` stays in scope.
      'packages/*/lib/**',
      // Per-package build-time scripts (e.g. nutpatch/scripts/check-patch-
      // compat.ts) — same shape as top-level scripts/, Node-only tooling.
      'packages/*/scripts/**',
      // coco-payment-ux is a file-dep with its own docs site (Vitepress) +
      // vendored reference apps. `src/` and `__tests__/` are still linted.
      'coco-payment-ux/docs/**',
      // Native module subprojects — not part of the JS lint surface.
      'modules/**',
      // Tooling scripts run under Node, not the app TS project.
      'codereview/**',
      'scripts/**',
      // Native iOS app extension targets (widget, etc) — Swift + plist
      // plus a `expo-target.config.js` that legitimately holds hex
      // colors for the native side.
      'targets/**',
      // ios/android build dirs (defensive — usually gitignored).
      'ios/**',
      'android/**',
      // Subagent skill template files — outside the TS project, parser
      // can't resolve them. Not part of the runtime surface.
      '.agents/**',
    ],
  },
  expoConfig,
  eslintPluginPrettierRecommended,
  // Type-aware linting for the TS/TSX project. `projectService: true` lets
  // typescript-eslint pick up `tsconfig.json` without us hand-maintaining a
  // `parserOptions.project` array. Required for any rule that needs type
  // info (`no-floating-promises`, `no-misused-promises`, `no-unsafe-*`, etc.).
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // Catches every `any`-typed value at the seam — the exact shape we
      // keep paying for in audit slices ("drop type-laundering casts",
      // "drop operation:any casts", "narrow Button/Spinner any").
      '@typescript-eslint/no-explicit-any': 'error',
      // Override eslint-config-expo's `warn` + `allow` to `error` + `never`,
      // banning both `<T>x` style and `{ ... } as T` object-literal casts.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      // Catches un-awaited promises — the shape behind the "cancel async
      // writes on effect cleanup" and "thread AbortSignal through apiClient"
      // slices. Allow `void promise` as the explicit fire-and-forget escape.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // Catches async functions passed where a sync callback is expected
      // (e.g. `onPress={async () => ...}` — fine, but `useEffect(async ...)`
      // — not fine). Allow void-returning attribute handlers, ban only the
      // ones that genuinely break (return-position promise-as-boolean,
      // spread, etc.).
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: { attributes: false, arguments: false },
        },
      ],
    },
  },
  {
    plugins: {
      'unused-imports': require('eslint-plugin-unused-imports'),
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
      },
    },
    rules: {
      'no-empty': 0,
      // Raw `console.*` calls bypass the scoped-logger registry, escape
      // log redaction (secret/PII scrubbing), don't get tagged with the
      // calling module/profile, and ship as production hot-path overhead.
      // Slices that kept hitting this: `inject logger at coco-payment-ux
      // seam, drop raw console`, `scope domain logs through the registered
      // child loggers`, `drop render-body log calls from screen
      // components`, `drop module-load side effects`. Use the scoped
      // logger from `@/shared/lib/logger` (or its child via
      // `logger.child({ scope: '...' })`) instead. No allow-list — `warn`
      // and `error` route through the logger too (it has level-aware
      // transports). Exempted in the logger's own transport-fallback site
      // and at the pre-logger bootstrap layer (app.config.js, polyfills.js).
      'no-console': 'error',
      // Remove unused imports
      'unused-imports/no-unused-imports': 'error',
      // Remove unused variables but allow prefix `_` to ignore
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      // Disable import/no-unresolved since TypeScript handles this
      'import/no-unresolved': 'off',
      // Force every tap surface through the shared `Pressable` at
      // `@/shared/ui/primitives/Pressable`, which routes `onPress`
      // through `useSingleFlight`. Importing the raw RN names —
      // including the legacy `TouchableOpacity`, which the codebase no
      // longer wraps — would silently bypass that guard.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Pressable', 'TouchableOpacity'],
              message:
                "Import { Pressable } from '@/shared/ui/primitives/Pressable' instead. The shared primitive auto-guards onPress against rapid double-tap re-entry; importing the raw RN names bypasses that guard. The legacy `TouchableOpacity` shape is preserved via Pressable's `activeOpacity` prop.",
            },
          ],
        },
      ],
      // `Dimensions.get('window' | 'screen')` snapshots the viewport once and
      // never updates on rotation, foldable resize, or split-screen — UI that
      // depends on it goes stale. Use `useWindowDimensions()` from react-native
      // inside components, which subscribes via change events. Pure helpers
      // should accept a `windowWidth: number` parameter from the caller's hook.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Dimensions'][callee.property.name='get']",
          message:
            "Use `useWindowDimensions()` from 'react-native' inside components, or accept a `windowWidth` parameter in helpers. `Dimensions.get(...)` snapshots the viewport once and won't react to rotation, foldables, or split-screen.",
        },
        // Hardcoded hex colors drift away from the theme system and survive
        // theme flips (light/dark/custom palettes). Slices that kept hitting
        // this: `kill module-scope and hardcoded colors that survive theme
        // flips`, `consolidate raw '#F7931A' into BITCOIN_ACCENT token`,
        // `drop hardcoded #3B82F6 in theme picker`, `replace hardcoded
        // brand hexes with theme tokens`. Match `#RGB`, `#RGBA`, `#RRGGBB`,
        // `#RRGGBBAA`. Exempted in the canonical color homes via the
        // override block below.
        {
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            "Hardcoded hex colors bypass the theme system. For theme-aware values use `useThemeColor` from '@/shared/hooks/useThemeColor'; for cross-theme brand constants (Bitcoin orange, BLE blue, connected green) import from '@/shared/lib/brandColors' (BITCOIN_ACCENT / BLUETOOTH_ACCENT / CONNECTED_ACCENT). If you need a new cross-theme constant, add a named export to `shared/lib/brandColors.ts` rather than inlining the hex.",
        },
      ],
    },
    ignores: [
      'dist/*',
      // Vendored reference apps inside the local coco-payment-ux dep —
      // not our code, kept verbatim for protocol cross-checking. Lint
      // rules have no jurisdiction over them.
      'coco-payment-ux/docs/references/**',
    ],
  },
  // The shared Pressable IS the wrapper — it must import the raw RN
  // name. Allow only that one file to break the rule above.
  {
    files: ['shared/ui/primitives/Pressable.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Two known callers legitimately need a frozen snapshot rather than a
  // rotation-reactive value. Both are tracked as deferred follow-ups in
  // __audits__/ — when they land, drop these exemptions.
  //   - app/_layout.tsx: splash overlay measurements are taken once at app
  //     launch (before any rotation could matter) and used to morph into a
  //     QR-button anchor. Subscribing to dimension changes here would
  //     invalidate the morph-source rectangle mid-animation.
  //   - features/splitBill/components/ParticipantCardDeck.tsx: STEP /
  //     CARD_W / SIDE_PAD feed `useAnimatedStyle` worklets and the carousel
  //     snap math; converting these to reactive values needs the worklet
  //     deps to thread through the SharedValue path, out of scope here.
  {
    files: ['app/_layout.tsx', 'features/splitBill/components/ParticipantCardDeck.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // `no-console` exemptions — three legitimate sites:
  //   - shared/lib/loggerCore.ts: transport-fallback escape hatch. When
  //     the logger's own transport throws, it falls through to
  //     `console.error` rather than swallow the failure (F-017).
  //   - app.config.js: build-time Expo config script, runs in Node before
  //     the app starts.
  //   - polyfills.js: runtime bootstrap that loads BEFORE the logger
  //     module exists; can't route through a logger that hasn't been
  //     initialised yet.
  {
    files: ['shared/lib/loggerCore.ts', 'app.config.js', 'polyfills.js'],
    rules: {
      'no-console': 'off',
    },
  },
  // Canonical hex-color homes — these files ARE the theme/brand-token
  // source of truth, so hex literals here are the answer, not the
  // problem. Disabling `no-restricted-syntax` wholesale (vs. selector-
  // by-selector) is acceptable because none of these files touch
  // `Dimensions.get(...)` either.
  //   - themes.ts: the theme palette table.
  //   - shared/lib/themeEngine.ts: palette generation / OKLCH math.
  //   - shared/lib/brandColors.ts: cross-theme brand constants
  //     (BITCOIN_ACCENT etc).
  //   - shared/lib/colorExtraction.ts: image-to-palette color math.
  //   - config/backgroundImageThemes.ts: art-directed gradient stops.
  {
    files: [
      'themes.ts',
      'shared/lib/themeEngine.ts',
      'shared/lib/brandColors.ts',
      'shared/lib/colorExtraction.ts',
      'config/backgroundImageThemes.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]);
