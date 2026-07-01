import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Monorepo layout: coco is a submodule under app/, deps hoist to the workspace root.
// (If wallet's vitest @noble realm drifts, re-validate these two paths against the
// actual post-`bun install` tree — they pin coco's bundled @noble versions.)
const cocoBunModules = resolve(__dirname, '../app/coco/node_modules/.bun');
const localNodeModules = resolve(__dirname, '../node_modules');

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: [
      {
        find: '@cashu/cashu-ts',
        replacement: resolve(__dirname, '../node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js'),
      },
      {
        find: '@cashu/coco-core',
        replacement: resolve(__dirname, '../node_modules/@cashu/coco-core/dist/index.js'),
      },
      {
        find: '@noble/curves/utils.js',
        replacement: resolve(localNodeModules, '@noble/curves/utils.js'),
      },
      {
        find: '@noble/curves/secp256k1.js',
        replacement: resolve(localNodeModules, '@noble/curves/secp256k1.js'),
      },
      {
        find: '@noble/hashes/sha2.js',
        replacement: resolve(localNodeModules, '@noble/hashes/sha2.js'),
      },
      {
        find: '@noble/hashes/utils.js',
        replacement: resolve(localNodeModules, '@noble/hashes/utils.js'),
      },
      {
        find: '@noble/hashes/hmac.js',
        replacement: resolve(localNodeModules, '@noble/hashes/hmac.js'),
      },
      {
        find: '@noble/hashes/pbkdf2.js',
        replacement: resolve(localNodeModules, '@noble/hashes/pbkdf2.js'),
      },
      {
        find: '@noble/hashes/webcrypto.js',
        replacement: resolve(localNodeModules, '@noble/hashes/webcrypto.js'),
      },
      {
        find: '@noble/hashes/legacy.js',
        replacement: resolve(localNodeModules, '@noble/hashes/legacy.js'),
      },
      {
        find: /^@noble\/curves\/(.*)$/,
        replacement: resolve(cocoBunModules, '@noble+curves@2.2.0/node_modules/@noble/curves/$1'),
      },
      {
        find: '@noble/curves',
        replacement: resolve(
          cocoBunModules,
          '@noble+curves@2.2.0/node_modules/@noble/curves/index.js'
        ),
      },
      {
        find: /^@noble\/hashes\/(.*)$/,
        replacement: resolve(cocoBunModules, '@noble+hashes@2.2.0/node_modules/@noble/hashes/$1'),
      },
      {
        find: '@noble/hashes',
        replacement: resolve(
          cocoBunModules,
          '@noble+hashes@2.2.0/node_modules/@noble/hashes/index.js'
        ),
      },
      {
        find: /^@scure\/base$/,
        replacement: resolve(localNodeModules, '@scure/base/index.js'),
      },
      {
        find: /^@scure\/bip32$/,
        replacement: resolve(localNodeModules, '@scure/bip32/index.js'),
      },
    ],
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    testTimeout: 30000,
    server: {
      deps: {
        inline: [/@cashu\/cashu-ts/, /@cashu\/coco-core/, /@scure\//, /@noble\//],
      },
    },
  },
});
