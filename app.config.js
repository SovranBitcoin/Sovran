// This file extends app.json with dynamic configuration.
// EAS will auto-increment buildNumber/versionCode in app.json,
// while this file handles dynamic values like bundle identifiers.

module.exports = ({ config }) => {
  const buildProfile =
    process.env.EAS_BUILD_PROFILE ||
    process.env.APP_VARIANT ||
    process.env.EXPO_PUBLIC_ENV ||
    'production';
  const isDevelopment = buildProfile === 'development';

  // Debug logging to verify bundle identifier selection
  if (process.env.EAS_BUILD_PROFILE || process.env.APP_VARIANT) {
    console.log(`[app.config.js] Build profile: ${buildProfile}, isDevelopment: ${isDevelopment}`);
    console.log(
      `[app.config.js] Bundle identifier will be: ${isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin'}`
    );
  }

  // Spread the static config from app.json and override only what's needed
  return {
    ...config,
    plugins: [...(config.plugins || []), 'expo-maps'],
    ios: {
      ...config.ios,
      bundleIdentifier: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
    },
    android: {
      ...config.android,
      package: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
    },
  };
};
