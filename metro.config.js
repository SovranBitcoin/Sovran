const { withMonicon } = require('@monicon/metro');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const { icons } = require('assets/icons');

// eslint-disable-next-line no-undef
const config = getDefaultConfig(__dirname);

// I guess I hate working within a specific icon library...
const configWithMonicon = withMonicon(config, {
  icons: icons,
});

configWithMonicon

module.exports = withNativeWind(configWithMonicon, { input: './global.css' });
