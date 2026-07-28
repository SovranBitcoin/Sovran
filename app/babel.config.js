module.exports = function (api) {
  api.cache(true);

  let plugins = [];

  plugins.push([
    'module-resolver',
    {
      root: ['./'],
      alias: {
        '@/shared': './shared',
        '@/features': './features',
        '@/sheets': './shared/lib/popup/sheets',
        '@/navigation': './navigation',
        '@/config': './config',
        '@/themes': './themes',
        '@': './',
        assets: './assets',
      },
    },
  ]);

  // SDK 56: babel-preset-expo auto-includes react-native-worklets/plugin when
  // react-native-worklets is installed, so an explicit reanimated/worklets
  // plugin entry here would double-apply the worklet transform.

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
