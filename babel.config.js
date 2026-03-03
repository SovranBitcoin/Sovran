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
        '@/sheets': './sheets',
        '@/navigation': './navigation',
        '@/config': './config',
        '@/redux': './redux',
        '@/themes': './themes',
        '@': './',
        assets: './assets',
      },
    },
  ]);

  plugins.push('react-native-reanimated/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
