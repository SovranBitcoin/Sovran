import { BlurTint } from 'expo-blur'

export interface BackgroundImageAttributes {
  primary: string
  secondary: string
  text: string
  tint: BlurTint
}

export const BACKGROUND_IMAGE_ATTRIBUTES: Record<string, BackgroundImageAttributes> = {
  'bg.png': { primary: '#A855F7', secondary: '#581C87', text: '#FFFFFF', tint: 'prominent' },
  'bg2.png': { primary: '#F97316', secondary: '#7C2D12', text: '#FFFFFF', tint: 'prominent' },
  'bg3.png': { primary: '#38BDF8', secondary: '#0C4A6E', text: '#FFFFFF', tint: 'prominent' },
  'bg4.png': { primary: '#34D399', secondary: '#064E3B', text: '#FFFFFF', tint: 'prominent' },
  'bg5.png': {
    primary: '#3B82F6',
    secondary: '#1E3A8A',
    text: '#FFFFFF',
    tint: 'systemChromeMaterialLight',
  },
  'static.png': { primary: '#FFFFFF', secondary: '#000000', text: '#FFFFFF', tint: 'prominent' },
}
