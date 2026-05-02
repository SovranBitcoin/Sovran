const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
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
      // Force every tap surface through the shared primitives at
      // `@/shared/ui/primitives/{Pressable,TouchableOpacity}`. Those
      // wrappers route `onPress` through `useSingleFlight` so the
      // single-flight guard against double-tap re-entrancy is structural
      // — importing the raw RN names would silently bypass it.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Pressable', 'TouchableOpacity'],
              message:
                'Import Pressable / TouchableOpacity from @/shared/ui/primitives/{Pressable,TouchableOpacity} instead. The shared primitives auto-guard onPress against rapid double-tap re-entry; importing the raw RN names bypasses that guard.',
            },
          ],
        },
      ],
    },
    ignores: ['dist/*'],
  },
  // The shared primitives ARE the wrappers — they must import the raw
  // RN names. Allow only those two files to break the rule above.
  {
    files: [
      'shared/ui/primitives/Pressable.tsx',
      'shared/ui/primitives/TouchableOpacity.tsx',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]);
