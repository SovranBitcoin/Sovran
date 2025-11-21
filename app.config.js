/**
 * @fileoverview Expo app configuration with environment-based bundle identifiers
 *
 * This config supports multiple build profiles with different bundle identifiers
 * to allow development and production builds to coexist on the same device.
 */

import appJson from './app.json';

export default () => {
  const flavor = process.env.FLAVOR || process.env.EAS_BUILD_PROFILE || 'production';

  // Determine bundle identifier based on flavor
  const iosBundleIdentifier =
    flavor === 'development' ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin';
  const androidPackage = flavor === 'development' ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin';

  return {
    ...appJson,
    expo: {
      ...appJson.expo,
      ios: {
        ...appJson.expo.ios,
        bundleIdentifier: iosBundleIdentifier,
      },
      android: {
        ...appJson.expo.android,
        package: androidPackage,
      },
    },
  };
};
