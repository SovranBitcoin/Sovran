import { BlurTint } from 'expo-blur';
import { computeGreys, computeShades } from './colors';
import { darken, getLuminance, parseToHsl } from 'polished';

export interface BackgroundImageAttributes {
  id: string;
  shades: Record<100 | 200 | 300 | 400 | 500, string>;
  greys: Record<number | '2300', string>;
  text: string;
  tint: BlurTint;
  dominantColors?: string[];
}

type GreyStrategy = 'darkest' | 'brightest' | 'pastel';

type BackgroundConfig = {
  id: string;
  base: string | string[];
  tint?: BlurTint;
  darkenAmount?: number;
  strategy?: GreyStrategy;
};

// Utility scoring
const darkest = (colors: string[]) =>
  colors.reduce((a, b) => (getLuminance(a) < getLuminance(b) ? a : b));

const brightest = (colors: string[]) =>
  colors.reduce((a, b) => (getLuminance(a) > getLuminance(b) ? a : b));

const pastelScore = (hex: string) => {
  const { lightness, saturation } = parseToHsl(hex);
  return lightness - saturation * 0.5;
};

const mostPastel = (colors: string[]) =>
  colors.reduce((a, b) => (pastelScore(a) > pastelScore(b) ? a : b));

const pickByStrategy = (colors: string[], strategy: GreyStrategy) => {
  switch (strategy) {
    case 'darkest':
      return darkest(colors);
    case 'brightest':
      return brightest(colors);
    case 'pastel':
      return mostPastel(colors);
    default:
      return darkest(colors); // fallback
  }
};

const makeBackgroundAttributes = ({
  id,
  base,
  tint = 'prominent',
  darkenAmount,
  strategy = 'darkest',
}: BackgroundConfig): BackgroundImageAttributes => {
  const isArray = Array.isArray(base);
  const baseColor = isArray ? brightest(base) : base;
  const greysBase = computeGreys('dark', baseColor);

  const greys =
    isArray && darkenAmount != null
      ? {
          ...greysBase,
          2300: darken(darkenAmount, pickByStrategy(base, strategy)),
        }
      : greysBase;

  return {
    id,
    shades: computeShades(baseColor),
    greys,
    text: '#FFFFFF',
    tint,
    ...(isArray ? { dominantColors: base } : {}),
  };
};

export const BACKGROUND_IMAGE_ATTRIBUTES: Record<string, BackgroundImageAttributes> = {
  'bg.png': makeBackgroundAttributes({ id: 'bg.png', base: '#A855F7' }),
  'bg2.png': makeBackgroundAttributes({ id: 'bg2.png', base: '#F97316' }),
  'bg3.png': makeBackgroundAttributes({ id: 'bg3.png', base: '#38BDF8' }),
  'bg4.png': makeBackgroundAttributes({ id: 'bg4.png', base: '#34D399' }),
  'bg5.png': makeBackgroundAttributes({
    id: 'bg5.png',
    base: ['#b3a6d6', '#4811fd', '#9f0ffa', '#f936d3', '#3ad9fa'],
    darkenAmount: 0.2,
    tint: 'extraLight',
    strategy: 'pastel',
  }),

  'bg6.png': makeBackgroundAttributes({
    id: 'bg6.png',
    base: ['#f328a7', '#120871', '#5135ae', '#9e0aa5', '#51048b'],
    darkenAmount: 0.2,
  }),
  'bg7.png': makeBackgroundAttributes({
    id: 'bg7.png',
    base: ['#a63365', '#510e5f', '#0e2663', '#060437', '#117f98'],
    darkenAmount: 0.075,
  }),
  'bg8.png': makeBackgroundAttributes({
    id: 'bg8.png',
    base: ['#03aabe', '#ad0257', '#0b0824'],
    darkenAmount: 0.05,
  }),
  'bg9.png': makeBackgroundAttributes({
    id: 'bg9.png',
    base: ['#225cb2', '#0d012f', '#250c63', '#2610ae', '#1797d9'],
    darkenAmount: 0.05,
  }),
  'bg10.png': makeBackgroundAttributes({
    id: 'bg10.png',
    base: ['#492295', '#6d38b2', '#331766', '#281242', '#150b27'],
    darkenAmount: 0.05,
  }),
  'bg11.gif': makeBackgroundAttributes({
    id: 'bg11.gif',
    base: ['#687cbd', '#7dbce1', '#8156aa', '#af6bbb', '#9f90ca'],
    darkenAmount: 0.05,
  }),
};
