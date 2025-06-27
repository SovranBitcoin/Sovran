import { BlurTint } from 'expo-blur';
import { computeGreys, computeShades } from './colors';

export interface BackgroundImageAttributes {
  shades: Record<100 | 200 | 300 | 400 | 500, string>;
  greys: Record<number, string>;
  text: string;
  tint: BlurTint;
}

export const BACKGROUND_IMAGE_ATTRIBUTES: Record<string, BackgroundImageAttributes> = {
  'bg.png': {
    shades: computeShades('#A855F7'),
    greys: computeGreys('dark'),
    text: '#FFFFFF',
    tint: 'prominent',
  },
  'bg2.png': {
    shades: computeShades('#F97316'),
    greys: computeGreys('dark'),
    text: '#FFFFFF',
    tint: 'prominent',
  },
  'bg3.png': {
    shades: computeShades('#38BDF8'),
    greys: computeGreys('dark'),
    text: '#FFFFFF',
    tint: 'prominent',
  },
  'bg4.png': {
    shades: computeShades('#34D399'),
    greys: computeGreys('dark'),
    text: '#FFFFFF',
    tint: 'prominent',
  },
  'bg5.png': {
    shades: computeShades('#C8348A'),
    greys: computeGreys('dark'),
    text: '#FFFFFF',
    tint: 'extraLight',
  },
  'bg6.png': {
    shades: computeShades('#5E1B72'),
    greys: computeGreys('dark', '#5E1B72'),
    text: '#FFFFFF',
    tint: 'prominent',
  },
};
