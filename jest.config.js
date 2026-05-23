/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/node',
  moduleNameMapper: {
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
    '/coco-payment-ux/',
    '/coco-cashu-plugin-p2pk-import/',
  ],
  modulePathIgnorePatterns: ['/coco-payment-ux/', '/coco-cashu-plugin-p2pk-import/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nostr-tools|@scure|@noble|coco-cashu-core|@cashu/cashu-ts|@sovranbitcoin/.*)',
  ],
};
