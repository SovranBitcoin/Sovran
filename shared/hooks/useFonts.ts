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
};

export function useFonts() {
  const [loaded, error] = useExpoFonts(FONTS);

  useEffect(() => {
    if (loaded) log.info('fonts.loaded', { count: Object.keys(FONTS).length });
    if (error) log.error('fonts.error', { error });
  }, [loaded, error]);

  return [loaded, error] as const;
}
