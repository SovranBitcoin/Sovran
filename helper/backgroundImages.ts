import { BlurTint } from 'expo-blur';
import { ImageSource } from 'expo-image';
import { computeGreys, computeShades, hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './colors';
import { darken, getLuminance, parseToHsl } from 'polished';

export interface BackgroundImageAttributes {
  id: string;
  shades: Record<100 | 200 | 300 | 400 | 500, string>;
  greys: Record<number | '2300', string>;
  text: string;
  tint: BlurTint;
  dominantColors?: string[];
}

export interface BackgroundImageMeta {
  id: string;
  name: string;
  category: string;
  source: ImageSource;
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

function learnedBlurTransform(hex) {
  const { r, g, b } = hexToRgb(hex);

  const red = 0.4533 * r + 0.1569 * g + 0.1992 * b + 10.8973;
  const green = 0.1467 * r + 0.3137 * g - 0.2816 * b + 18.3145;
  const blue = 0.12 * r - 0.3529 * g + 0.5718 * b + 16.7012;

  return rgbToHex(
    Math.min(255, Math.max(0, Math.round(red))),
    Math.min(255, Math.max(0, Math.round(green))),
    Math.min(255, Math.max(0, Math.round(blue)))
  );
}

export const adjustLuminanceOfHex = (hex: string, newL: number): string => {
  const { r, g, b } = hexToRgb(hex);
  const { h, s } = rgbToHsl(r, g, b);
  const { r: nr, g: ng, b: nb } = hslToRgb(h, s, Math.min(100, Math.max(0, newL)));
  return rgbToHex(nr, ng, nb);
};

export const getLuminanceFromHex = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex);
  const { l } = rgbToHsl(r, g, b);
  return l;
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
        ...Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800].map((key) => [
            key,
            adjustLuminanceOfHex(
              learnedBlurTransform(darken(darkenAmount, pickByStrategy(base, strategy))),
              getLuminanceFromHex(greysBase[key])
            ),
          ])
        ),
        900: learnedBlurTransform(darken(darkenAmount, pickByStrategy(base, strategy))),
        950: darken(darkenAmount, pickByStrategy(base, strategy)),
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
    base: ['#0C051C', '#3F92B2', '#0D1240', '#2C2575', '#4C75B0'],
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
  'bg12.png': makeBackgroundAttributes({
    id: 'bg12.png',
    base: ['#79874f', '#0c0943', '#811669', '#1c7a94', '#111c82'],
    darkenAmount: 0.1,
  }),
  'bg14.png': makeBackgroundAttributes({
    id: 'bg14.png',
    base: ['#335f00', '#092a00', '#7ba901', '#99c4ea', '#1587f0'],
    darkenAmount: 0.05,
  }),
  'bg15.png': makeBackgroundAttributes({
    id: 'bg15.png',
    base: ['#2F234F', '#106B8B', '#263D6B', '#1191AD'],
    darkenAmount: 0.1,
  }),
  'bg16.png': makeBackgroundAttributes({
    id: 'bg16.png',
    base: [
      '#3A032C',
      '#321F49',
      '#363A6D',
      '#1F4F6D',
      '#4F1E52',
      '#0F6D83',
      '#405981',
      '#6F205E',
      '#5E3F72',
      '#5F5E82',
    ],
    darkenAmount: 0,
  }),
  'bg17.png': makeBackgroundAttributes({
    id: 'bg17.png',
    base: ['#013F4D', '#030D10', '#045F6E', '#012032', '#018F8A'],
    darkenAmount: 0,
  }),
};

export const BACKGROUND_IMAGES: Record<string, BackgroundImageMeta> = {
  'bg.png': {
    id: 'bg.png',
    name: 'Glow',
    category: 'Dynamic',
    source: require('assets/images/backgrounds/bg.png'),
  },
  'bg2.png': {
    id: 'bg2.png',
    name: 'Lava',
    category: 'Dynamic',
    source: require('assets/images/backgrounds/bg2.png'),
  },
  'bg3.png': {
    id: 'bg3.png',
    name: 'Lights',
    category: 'Dynamic',
    source: require('assets/images/backgrounds/bg3.png'),
  },
  'bg4.png': {
    id: 'bg4.png',
    name: 'Snake',
    category: 'Dynamic',
    source: require('assets/images/backgrounds/bg4.png'),
  },
  'bg5.png': {
    id: 'bg5.png',
    name: 'Static 1',
    category: 'Static',
    source: require('assets/images/backgrounds/bg5.png'),
  },
  'bg6.png': {
    id: 'bg6.png',
    name: 'Static 2',
    category: 'Static',
    source: require('assets/images/backgrounds/bg6.png'),
  },
  'bg7.png': {
    id: 'bg7.png',
    name: 'Static 3',
    category: 'Static',
    source: require('assets/images/backgrounds/bg7.png'),
  },
  'bg8.png': {
    id: 'bg8.png',
    name: 'Static 4',
    category: 'Static',
    source: require('assets/images/backgrounds/bg8.png'),
  },
  'bg9.png': {
    id: 'bg9.png',
    name: 'Static 5',
    category: 'Static',
    source: require('assets/images/backgrounds/bg9.png'),
  },
  'bg10.png': {
    id: 'bg10.png',
    name: 'Static 6',
    category: 'Static',
    source: require('assets/images/backgrounds/bg10.png'),
  },
  'bg11.gif': {
    id: 'bg11.gif',
    name: 'Static 7',
    category: 'Static',
    source: require('assets/images/backgrounds/bg11.gif'),
  },
  'bg12.png': {
    id: 'bg12.png',
    name: 'Static 8',
    category: 'Static',
    source: require('assets/images/backgrounds/bg12.png'),
  },
  'bg14.png': {
    id: 'bg14.png',
    name: 'Static 9',
    category: 'Static',
    source: require('assets/images/backgrounds/bg14.png'),
  },
  'bg15.png': {
    id: 'bg15.png',
    name: 'Static 10',
    category: 'Static',
    source: require('assets/images/backgrounds/bg15.png'),
  },
  'bg16.png': {
    id: 'bg16.png',
    name: 'Static 11',
    category: 'Static',
    source: require('assets/images/backgrounds/bg16.png'),
  },
  'bg17.png': {
    id: 'bg17.png',
    name: 'Static 12',
    category: 'Static',
    source: require('assets/images/backgrounds/bg17.png'),
  },
};
