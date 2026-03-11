// This file extends app.json with dynamic configuration.
// EAS will auto-increment buildNumber/versionCode in app.json,
// while this file handles dynamic values like bundle identifiers.

module.exports = ({ config }) => {
  const buildProfile =
    process.env.EAS_BUILD_PROFILE ||
    process.env.APP_VARIANT ||
    process.env.EXPO_PUBLIC_ENV ||
    'production';
  const isDevelopment = buildProfile === 'development' || buildProfile === 'preview';

  // Debug logging to verify bundle identifier selection
  if (process.env.EAS_BUILD_PROFILE || process.env.APP_VARIANT) {
    console.log(`[app.config.js] Build profile: ${buildProfile}, isDevelopment: ${isDevelopment}`);
    console.log(
      `[app.config.js] Bundle identifier will be: ${isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin'}`
    );
  }

  const appIcon = './assets/images/light.png';
  const androidGoogleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

  // Spread the static config from app.json and override only what's needed
  return {
    ...config,
    icon: appIcon,
    plugins: [
      ...(config.plugins || []),
      'expo-maps',
      'expo-liquid-glass-native',
      './plugins/withLiquidGlassMainApplication',
    ],
    ios: {
      ...config.ios,
      bundleIdentifier: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
    },
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        googleMaps: {
          ...config.android?.config?.googleMaps,
          apiKey: androidGoogleMapsApiKey,
        },
      },
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: appIcon,
      },
      package: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
    },
  };
};
