/**
 * Android packaging fixes that must survive `expo prebuild --clean`.
 *
 * expo-modules-core and react-native-worklets (pinned ahead at 0.10.x, vs the
 * 0.8.x Expo SDK 56 expects) both package a libworklets.so; without a
 * pickFirst the debug build fails at :app:mergeDebugNativeLibs with a
 * duplicate-file error. The generated app/build.gradle already consumes
 * `android.packagingOptions.pickFirsts` from gradle.properties.
 */
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withAndroidPackagingFixes(config) {
  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'android.packagingOptions.pickFirsts')
    );
    mod.modResults.push(
      {
        type: 'comment',
        value:
          'expo-modules-core and react-native-worklets (0.10 pin) both package libworklets.so; keep the first copy at merge (plugins/withAndroidPackagingFixes.js).',
      },
      {
        type: 'property',
        key: 'android.packagingOptions.pickFirsts',
        value: '**/libworklets.so',
      }
    );
    return mod;
  });
};
