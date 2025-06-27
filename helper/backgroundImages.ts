import { BlurTint } from 'expo-blur';

export interface BackgroundImageAttributes {
  primary: string;
  secondary: string;
  text: string;
  tint: BlurTint;
}

export const BACKGROUND_IMAGE_ATTRIBUTES: Record<string, BackgroundImageAttributes> = {
  'bg.png': { primary: '#A855F7', secondary: '#581C87', text: '#FFFFFF', tint: 'prominent' },
  'bg2.png': { primary: '#F97316', secondary: '#7C2D12', text: '#FFFFFF', tint: 'prominent' },
  'bg3.png': { primary: '#38BDF8', secondary: '#0C4A6E', text: '#FFFFFF', tint: 'prominent' },
  'bg4.png': { primary: '#34D399', secondary: '#064E3B', text: '#FFFFFF', tint: 'prominent' },
  'bg5.png': {
    primary: '#C8348A',
    secondary: '#AB99E3',
    text: '#FFFFFF',
    tint: 'extraLight',
  },
  'bg6.png': {
    primary: '#5E1B72',
    secondary: '#6B4D9A',
    text: '#FFFFFF',
    tint: 'extraLight',
  },
};
