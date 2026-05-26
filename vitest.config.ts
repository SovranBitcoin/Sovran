import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const cocoBunModules = resolve(__dirname, '../../coco/node_modules/.bun');

export default defineConfig({
  resolve: {
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
        find: '@scure/base',
        replacement: resolve(
          cocoBunModules,
          '@scure+base@2.2.0/node_modules/@scure/base/index.js'
        ),
      },
      {
        find: '@scure/bip32',
        replacement: resolve(
          cocoBunModules,
          '@scure+bip32@2.2.0/node_modules/@scure/bip32/index.js'
        ),
      },
    ],
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    testTimeout: 30000,
    deps: {
      inline: [/@cashu\/cashu-ts/, /@cashu\/coco-core/, /@scure\//, /@noble\//],
    },
  },
});
