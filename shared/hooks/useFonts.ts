import { useEffect } from 'react';
import { useFonts as useExpoFonts } from 'expo-font';

import { log } from '@/shared/lib/logger';

// Use assets alias (babel maps assets to ./assets at project root)
const FONTS = {
  OxygenLight: require('assets/fonts/Oxygen/Oxygen-Light.ttf'),
  OxygenRegular: require('assets/fonts/Oxygen/Oxygen-Regular.ttf'),
  OxygenBold: require('assets/fonts/Oxygen/Oxygen-Bold.ttf'),
  OverpassLight: require('assets/fonts/Overpass/overpass-light.otf'),
  OverpassRegular: require('assets/fonts/Overpass/overpass-regular.otf'),
  OverpassSemibold: require('assets/fonts/Overpass/overpass-semibold.otf'),
  OverpassBold: require('assets/fonts/Overpass/overpass-bold.otf'),
  OverpassExtrabold: require('assets/fonts/Overpass/overpass-extrabold.otf'),
  OverpassHeavy: require('assets/fonts/Overpass/overpass-heavy.otf'),
  // Keyed by PostScript name so the native liquid-glass-text module
  // (which calls UIFont(name:)) can resolve these without any alias
  // mapping. See modules/liquid-glass-text/ios/LiquidGlassTextSwiftUI.swift.
  'MonaSans-Light': require('assets/fonts/MonaSans/MonaSans-Light.ttf'),
  'MonaSans-Regular': require('assets/fonts/MonaSans/MonaSans-Regular.ttf'),
  'MonaSans-Medium': require('assets/fonts/MonaSans/MonaSans-Medium.ttf'),
  'MonaSans-SemiBold': require('assets/fonts/MonaSans/MonaSans-SemiBold.ttf'),
  'MonaSans-Bold': require('assets/fonts/MonaSans/MonaSans-Bold.ttf'),
  'MonaSans-ExtraBold': require('assets/fonts/MonaSans/MonaSans-ExtraBold.ttf'),
  'MonaSans-Black': require('assets/fonts/MonaSans/MonaSans-Black.ttf'),
};

export function useFonts() {
  const [loaded, error] = useExpoFonts(FONTS);

  useEffect(() => {
    if (loaded) log.info('fonts.loaded', { count: Object.keys(FONTS).length });
    if (error) log.error('fonts.error', { error });
  }, [loaded, error]);

  return [loaded, error] as const;
}
