const expoNodePreset = require('jest-expo/node/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/node',
  // RN 0.85 eagerly resolves native modules (NativeSourceCode, feature flags,
  // NativeComponentRegistry) when a component is required. The jest-expo/node
  // preset doesn't install React Native's native-module mocks, so add RN's own
  // jest setup on top of the preset's to stub them out.
  setupFiles: [
    ...(expoNodePreset.setupFiles || []),
    require.resolve('@react-native/jest-preset/jest/setup.js'),
  ],
  moduleNameMapper: {
    // bc-ur uses CommonJS while cborg exposes only an import condition.
    // Resolve its real source so UR round-trip tests exercise the shipped codec.
    '^cborg$': [
      '<rootDir>/node_modules/cborg/cborg.js',
      '<rootDir>/../node_modules/cborg/cborg.js',
    ],
    // Probe app-local then the hoisted workspace-root node_modules (jest tries
    // each target in order and uses the first that exists). Under the bun
    // workspace these shared deps hoist to <root>/node_modules.
    '^@babel/runtime/(.*)$': [
      '<rootDir>/node_modules/@babel/runtime/$1',
      '<rootDir>/../node_modules/@babel/runtime/$1',
    ],
    '^@cashu/coco-core$': [
      '<rootDir>/node_modules/@cashu/coco-core/dist/index.js',
      '<rootDir>/../node_modules/@cashu/coco-core/dist/index.js',
    ],
    // Workspace-package subpath: same resolver gap as the coco v2 subpaths
    // below — `wallet`'s "exports" map is invisible here, so point at source.
    '^wallet/safeFetch$': '<rootDir>/../wallet/src/safeFetch.ts',
    // v2 subpath exports (jest's resolver here predates package "exports" maps)
    '^@cashu/coco-core/adapter$': [
      '<rootDir>/node_modules/@cashu/coco-core/dist/adapter.js',
      '<rootDir>/../node_modules/@cashu/coco-core/dist/adapter.js',
    ],
    '^@cashu/coco-core/plugin$': [
      '<rootDir>/node_modules/@cashu/coco-core/dist/plugin.js',
      '<rootDir>/../node_modules/@cashu/coco-core/dist/plugin.js',
    ],
    '^@cashu/coco-expo-sqlite$': [
      '<rootDir>/node_modules/@cashu/coco-expo-sqlite/dist/index.js',
      '<rootDir>/../node_modules/@cashu/coco-expo-sqlite/dist/index.js',
    ],
    '^@cashu/coco-react$': [
      '<rootDir>/node_modules/@cashu/coco-react/dist/index.js',
      '<rootDir>/../node_modules/@cashu/coco-react/dist/index.js',
    ],
    '^@/shared/(.*)$': '<rootDir>/shared/$1',
    '^@/features/(.*)$': '<rootDir>/features/$1',
    '^@/sheets/(.*)$': '<rootDir>/shared/lib/popup/sheets/$1',
    '^@/navigation/(.*)$': '<rootDir>/navigation/$1',
    '^@/config/(.*)$': '<rootDir>/config/$1',
    '^@/themes$': '<rootDir>/themes',
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    // The JSON-native harness uses Bun's test runner and Bun-only APIs. Keep
    // it out of the app's React Native/Jest lane; `bun run e2e:test` owns it.
    // `shared/lib/e2e/` holds harness support code that lives in the app tree
    // but is still Bun-only, so it needs naming separately from `<rootDir>/e2e/`.
    '<rootDir>/e2e/',
    '<rootDir>/shared/lib/e2e/',
    '/coco/',
    '/eNuts/',
    '/coco-cashu-plugin-p2pk-import/',
  ],
  modulePathIgnorePatterns: ['/coco-cashu-plugin-p2pk-import/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.bun/[^/]+/node_modules/)?(?:(jest-)?react-native|@react-native(-community)?|@bacons/.*|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/react-native-skia|nostr-tools|@scure|@noble|coco-cashu-core|@cashu/cashu-ts|@cashu/coco-core|@cashu/coco-expo-sqlite|@cashu/coco-react|@sovranbitcoin/.*|wallet|nostr|bitchat-module|standard-navigation|cborg|@shopify/flash-list))',
  ],
};
