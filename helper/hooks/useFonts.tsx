import { useFonts as useExpoFonts } from 'expo-font';

const FONTS = {
  OverpassBold: require('../../assets/fonts/Overpass/overpass-bold.otf'),
  OverpassBoldItalic: require('../../assets/fonts/Overpass/overpass-bold-italic.otf'),
  OverpassExtraboldItalic: require('../../assets/fonts/Overpass/overpass-extrabold-italic.otf'),
  OverpassExtrabold: require('../../assets/fonts/Overpass/overpass-extrabold.otf'),
  OverpassExtralightItalic: require('../../assets/fonts/Overpass/overpass-extralight-italic.otf'),
  OverpassExtralight: require('../../assets/fonts/Overpass/overpass-extralight.otf'),
  OverpassHeavyItalic: require('../../assets/fonts/Overpass/overpass-heavy-italic.otf'),
  OverpassHeavy: require('../../assets/fonts/Overpass/overpass-heavy.otf'),
  OverpassItalic: require('../../assets/fonts/Overpass/overpass-italic.otf'),
  OverpassLightItalic: require('../../assets/fonts/Overpass/overpass-light-italic.otf'),
  OverpassLight: require('../../assets/fonts/Overpass/overpass-light.otf'),
  OverpassRegular: require('../../assets/fonts/Overpass/overpass-regular.otf'),
  OverpassSemiboldItalic: require('../../assets/fonts/Overpass/overpass-semibold-italic.otf'),
  OverpassSemibold: require('../../assets/fonts/Overpass/overpass-semibold.otf'),
  OverpassThinItalic: require('../../assets/fonts/Overpass/overpass-thin-italic.otf'),
  OverpassThin: require('../../assets/fonts/Overpass/overpass-thin.otf'),
  OverpassMono: require('../../assets/fonts/Overpass/overpass-mono.ttf'),
};

export function useFonts() {
  return useExpoFonts(FONTS);
}
