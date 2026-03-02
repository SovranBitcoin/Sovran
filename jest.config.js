/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/node',
  testPathIgnorePatterns: ['/node_modules/', '/coco/', '/eNuts/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nostr-tools|@scure|@noble)',
  ],
};
