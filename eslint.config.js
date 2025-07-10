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
    rules: {
      'no-empty': false,
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
    },
    ignores: ['dist/*'],
  },
]);
