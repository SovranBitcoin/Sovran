module.exports = function (api) {
  api.cache(true);

  let plugins = [];

  plugins.push([
    'module-resolver',
    {
      root: ['./'],
      alias: {
        '@': './',
      },
    },
  ]);

  // Reanimated plugin MUST be last - it includes worklets internally
  plugins.push('react-native-reanimated/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
