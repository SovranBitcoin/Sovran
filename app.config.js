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

  return {
    expo: {
      name: 'Sovran',
      slug: 'sovran',
      version: '0.0.50',
      orientation: 'portrait',
      scheme: ['sovran', 'cashu'],
      userInterfaceStyle: 'automatic',
      splash: {
        image: './assets/images/splash.png',
        backgroundColor: '#000000',
        resizeMode: 'contain',
      },
      icon: './assets/images/sovran_black.png',
      assetBundlePatterns: ['**/*'],
      newArchEnabled: true,
      ios: {
        buildNumber: '6',
        infoPlist: {
          NSCameraUsageDescription:
            'Sovran will use your camera to scan QR codes to make it easier to send and receive payments.',
          ITSAppUsesNonExemptEncryption: false,
          'UISupportedInterfaceOrientations~ipad': [
            'UIInterfaceOrientationPortrait',
            'UIInterfaceOrientationPortraitUpsideDown',
            'UIInterfaceOrientationLandscapeLeft',
            'UIInterfaceOrientationLandscapeRight',
          ],
          UIBackgroundModes: ['fetch', 'bluetooth-central', 'bluetooth-peripheral'],
          UIDeviceFamily: [1],
          NSMotionUsageDescription:
            'Allow motion access to use the motion sensor to rotate the screen',
          NSPhotoLibraryAddUsageDescription:
            'Allow access to your photos to save them to your library',
          NSPhotoLibraryUsageDescription: 'Allow access to your photos to use them in the app',
          NSLocalNetworkUsageDescription:
            'This app requires access to network features for VPN functionality',
          NSLocationAlwaysAndWhenInUseUsageDescription:
            'Allow $(PRODUCT_NAME) to access your location',
          NSLocationAlwaysUsageDescription: 'Allow $(PRODUCT_NAME) to access your location',
          NSBluetoothAlwaysUsageDescription:
            'This app uses Bluetooth to connect with nearby devices for decentralized messaging.',
          NSBluetoothPeripheralUsageDescription:
            'This app uses Bluetooth to connect with nearby devices for decentralized messaging.',
        },
        bundleIdentifier: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
        supportsTablet: false,
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/images/sovran_black.png',
          backgroundColor: '#ffffff',
        },
        permissions: [
          'android.permission.CAMERA',
          'android.permission.RECORD_AUDIO',
          'android.permission.NFC',
        ],
        package: isDevelopment ? 'com.sovranbitcoin.dev' : 'com.sovranbitcoin',
      },
      web: {
        bundler: 'metro',
        output: 'static',
        favicon: './assets/images/favicon.png',
      },
      plugins: [
        [
          'expo-camera',
          {
            cameraPermission: 'Allow $(PRODUCT_NAME) to access your camera',
          },
        ],
        [
          'react-native-nfc-manager',
          {
            includeNdefEntitlement: false,
            selectIdentifiers: ['D2760000850100', 'D2760000850101', '5361746f63617368'],
          },
        ],
        'expo-build-properties',
        'expo-font',
        'expo-router',
        'expo-localization',
        'expo-video',
        'expo-secure-store',
        'expo-sqlite',
      ],
      extra: {
        router: {
          origin: false,
        },
        eas: {
          projectId: '09112d75-3a3a-49ba-bec6-ab881c5a2fa6',
        },
      },
      experiments: {
        typedRoutes: true,
      },
    },
  };
};
