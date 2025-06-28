import { BlurTint } from 'expo-blur';
import { computeGreys, computeShades } from './colors';
import { darken, getLuminance } from 'polished';

export interface BackgroundImageAttributes {
  shades: Record<100 | 200 | 300 | 400 | 500, string>;
  greys: Record<number | '2300', string>;
  text: string;
  tint: BlurTint;
  dominantColors?: string[];
  // You can easily extend this interface later
  // textSize?: string;
  // overlayOpacity?: number;
}

type BackgroundConfig = {
  base: string | string[];
  tint?: BlurTint;
  darkenAmount?: number;
};

const darkest = (colors: string[]) =>
  colors.reduce((a, b) => (getLuminance(a) < getLuminance(b) ? a : b));

const brightest = (colors: string[]) =>
  colors.reduce((a, b) => (getLuminance(a) > getLuminance(b) ? a : b));

const makeBackgroundAttributes = ({
  base,
  tint = 'prominent',
  darkenAmount,
}: BackgroundConfig): BackgroundImageAttributes => {
  const isArray = Array.isArray(base);
  const baseColor = isArray ? brightest(base) : base;
  const greysBase = computeGreys('dark', baseColor);

  const greys =
    isArray && darkenAmount != null
      ? { ...greysBase, 2300: darken(darkenAmount, darkest(base)) }
      : greysBase;

  return {
    shades: computeShades(baseColor),
    greys,
    text: '#FFFFFF',
    tint,
    ...(isArray ? { dominantColors: base } : {}),
  };
};

export const BACKGROUND_IMAGE_ATTRIBUTES: Record<string, BackgroundImageAttributes> = {
  'bg.png': makeBackgroundAttributes({ base: '#A855F7' }),
  'bg2.png': makeBackgroundAttributes({ base: '#F97316' }),
  'bg3.png': makeBackgroundAttributes({ base: '#38BDF8' }),
  'bg4.png': makeBackgroundAttributes({ base: '#34D399' }),
  'bg5.png': makeBackgroundAttributes({ base: '#C8348A', tint: 'extraLight' }),

  'bg6.png': makeBackgroundAttributes({
    base: ['#f328a7', '#120871', '#5135ae', '#9e0aa5', '#51048b'],
    darkenAmount: 0.2,
  }),
  'bg7.png': makeBackgroundAttributes({
    base: ['#a63365', '#510e5f', '#0e2663', '#060437', '#117f98'],
    darkenAmount: 0.05,
  }),
  'bg8.png': makeBackgroundAttributes({
    base: ['#03aabe', '#ad0257', '#0b0824'],
    darkenAmount: 0.05,
  }),
  'bg9.png': makeBackgroundAttributes({
    base: ['#225cb2', '#0d012f', '#250c63', '#2610ae', '#1797d9'],
    darkenAmount: 0.05,
  }),
};
