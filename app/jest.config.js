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
    // Match Metro's committed-runtime alias so component tests never depend on
    // @monicon/icon-loader's undeclared @monicon/runtime import being hoisted.
    '^@monicon/runtime$': '<rootDir>/.monicon/icons.js',
    '^@scure/bip32$': [
      '<rootDir>/node_modules/@scure/bip32/lib/esm/index.js',
      '<rootDir>/../node_modules/@scure/bip32/lib/esm/index.js',
    ],
    '^@/shared/(.*)$': '<rootDir>/shared/$1',
    '^@/features/(.*)$': '<rootDir>/features/$1',
    '^@/sheets/(.*)$': '<rootDir>/shared/lib/popup/sheets/$1',
    '^@/navigation/(.*)$': '<rootDir>/navigation/$1',
    '^@/config/(.*)$': '<rootDir>/config/$1',
    '^@/redux/(.*)$': '<rootDir>/redux/$1',
    '^@/themes$': '<rootDir>/themes',
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coco/',
    '/eNuts/',
    '/coco-cashu-plugin-p2pk-import/',
  ],
  modulePathIgnorePatterns: ['/coco-cashu-plugin-p2pk-import/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.bun/[^/]+/node_modules/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/react-native-skia|nostr-tools|@scure|@noble|coco-cashu-core|@cashu/cashu-ts|@cashu/coco-core|@cashu/coco-expo-sqlite|@cashu/coco-react|@sovranbitcoin/.*|wallet|nostr|bitchat-module|standard-navigation))',
  ],
};
