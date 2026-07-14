import { resolve } from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';

// Most `integration/` tests are deterministic in-memory contract tests and
// belong in the ordinary offline gate. Only these three load the live-mint
// helper. Include them deliberately with:
//   TEST_MINT_URL=http://127.0.0.1:3338 bun run test:live
// A stray TEST_MINT_URL alone never widens the default gate.
const LIVE = process.env.SOVRAN_E2E_LIVE === '1';
const LIVE_MINT_TESTS = [
  '__tests__/integration/machine-flow.test.ts',
  '__tests__/integration/operations.test.ts',
  '__tests__/integration/wallet-context.test.ts',
];

// Registry-dep layout (post coco-submodule): @cashu/* and the @noble/@scure
// realm hoist to the workspace root at the versions coco v2 pins (2.x), and
// packages that need older realms (nostr-tools' @scure/bip32 1.x with its
// @noble/curves 1.x) carry their own nested node_modules. Natural resolution
// is correct per-importer, so the only aliases left force the two @cashu
// packages to their published entry files.
const localNodeModules = resolve(__dirname, '../node_modules');

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: [
      {
        find: '@cashu/cashu-ts',
        replacement: resolve(localNodeModules, '@cashu/cashu-ts/lib/cashu-ts.es.js'),
      },
      {
        find: /^@cashu\/coco-core$/,
        replacement: resolve(localNodeModules, '@cashu/coco-core/dist/index.js'),
      },
      {
        find: '@cashu/coco-core/adapter',
        replacement: resolve(localNodeModules, '@cashu/coco-core/dist/adapter.js'),
      },
      {
        find: '@cashu/coco-core/plugin',
        replacement: resolve(localNodeModules, '@cashu/coco-core/dist/plugin.js'),
      },
    ],
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    exclude: LIVE ? configDefaults.exclude : [...configDefaults.exclude, ...LIVE_MINT_TESTS],
    globals: true,
    testTimeout: 30000,
    server: {
      deps: {
        inline: [/@cashu\/cashu-ts/, /@cashu\/coco-core/, /@scure\//, /@noble\//],
      },
    },
  },
});
