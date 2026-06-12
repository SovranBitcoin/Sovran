/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/node',
  moduleNameMapper: {
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
    '^@cashu/cashu-ts$': '<rootDir>/node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js',
    '^@cashu/coco-core$': '<rootDir>/node_modules/@cashu/coco-core/dist/index.js',
    '^@cashu/coco-expo-sqlite$': '<rootDir>/node_modules/@cashu/coco-expo-sqlite/dist/index.js',
    '^@cashu/coco-react$': '<rootDir>/node_modules/@cashu/coco-react/dist/index.js',
    '^@scure/bip32$': '<rootDir>/node_modules/@scure/bip32/lib/esm/index.js',
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
    'node_modules/(?!(?:\\.bun/[^/]+/node_modules/)?(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/react-native-skia|nostr-tools|@scure|@noble|coco-cashu-core|@cashu/cashu-ts|@cashu/coco-core|@cashu/coco-expo-sqlite|@cashu/coco-react|@sovranbitcoin/.*))',
  ],
};
