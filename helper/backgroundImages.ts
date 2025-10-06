import { ImageSource } from 'expo-image';

export interface BackgroundImageMeta {
  id: string;
  name: string;
  category: string;
  source: ImageSource;
}

export const BACKGROUND_IMAGES: Record<string, BackgroundImageMeta> = {
  royalpurple: {
    id: 'royalpurple',
    name: 'Royal Purple',
    category: 'Static',
    source: require('assets/images/backgrounds/royalpurple.png'),
  },
  mysticblue: {
    id: 'mysticblue',
    name: 'Mystic Blue',
    category: 'Static',
    source: require('assets/images/backgrounds/mysticblue.png'),
  },
  cosmicpurple: {
    id: 'cosmicpurple',
    name: 'Cosmic Purple',
    category: 'Static',
    source: require('assets/images/backgrounds/cosmicpurple.png'),
  },
  deepocean: {
    id: 'deepocean',
    name: 'Deep Ocean',
    category: 'Static',
    source: require('assets/images/backgrounds/deepocean.png'),
  },
};
