import { BlurTint } from 'expo-blur';
import { computeGreys, computeShades, computeTintedGreys } from './colors';

export interface BackgroundImageAttributes {
  shades: Record<100 | 200 | 300 | 400 | 500, string>;
  greys: Record<number, string>;
  text: string;
  tint: BlurTint;
}

export const BACKGROUND_IMAGE_ATTRIBUTES: Record<string, BackgroundImageAttributes> = {
  'bg.png': (() => {
    const s = computeShades('#A855F7');
    return {
      shades: s,
      greys: computeTintedGreys('dark', s[300]),
      text: '#FFFFFF',
      tint: 'prominent',
    };
  })(),
  'bg2.png': (() => {
    const s = computeShades('#F97316');
    return {
      shades: s,
      greys: computeTintedGreys('dark', s[300]),
      text: '#FFFFFF',
      tint: 'prominent',
    };
  })(),
  'bg3.png': (() => {
    const s = computeShades('#38BDF8');
    return {
      shades: s,
      greys: computeTintedGreys('dark', s[300]),
      text: '#FFFFFF',
      tint: 'prominent',
    };
  })(),
  'bg4.png': (() => {
    const s = computeShades('#34D399');
    return {
      shades: s,
      greys: computeTintedGreys('dark', s[300]),
      text: '#FFFFFF',
      tint: 'prominent',
    };
  })(),
  'bg5.png': (() => {
    const s = computeShades('#C8348A');
    return {
      shades: s,
      greys: computeTintedGreys('dark', s[300]),
      text: '#FFFFFF',
      tint: 'extraLight',
    };
  })(),
  'bg6.png': (() => {
    const s = computeShades('#5E1B72');
    return {
      shades: s,
      greys: computeTintedGreys('dark', s[300]),
      text: '#FFFFFF',
      tint: 'extraLight',
    };
  })(),
};
