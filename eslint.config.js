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
      // coco-payment-ux is a file-dep with its own docs site (Vitepress) +
      // vendored reference apps. `src/` and `__tests__/` are still linted.
      'coco-payment-ux/docs/**',
      // Native module subprojects — not part of the JS lint surface.
      'modules/**',
      // Tooling scripts run under Node, not the app TS project.
      'codereview/**',
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
]);
