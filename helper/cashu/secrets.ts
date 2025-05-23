// Private keys for Sovran giveaways, not super sensitive but better if kept secret.

import { Platform } from 'react-native';

// increase sure vicious tonight scale spend library language sketch decline edge adapt

export const giveaways = {
  christmas_2024_ios: {
    id: 'christmas_2024_ios',
    start: new Date('2024-12-25T00:00:00Z'),
    end: new Date('2025-01-05T23:59:59Z'),
    private_key: process.env.CHRISTMAS_2024_IOS_PRIVATE_KEY,
    public_key: process.env.CHRISTMAS_2024_IOS_PUBLIC_KEY,
    note: "Sovran's Christmas Giveaway 🎁",
    condition: () => Platform.OS === 'ios',
    error: () =>
      Platform.OS !== 'ios' && {
        title: 'Not redeemable on Android',
        message:
          'This ecash token is part of our iOS Christmas giveaway and is only redeemable on that platform.',
      },
  },
  christmas_2024_android: {
    id: 'christmas_2024_android',
    start: new Date('2024-12-25T00:00:00Z'),
    end: new Date('2025-01-05T23:59:59Z'),
    private_key: process.env.CHRISTMAS_2024_ANDROID_PRIVATE_KEY,
    public_key: process.env.CHRISTMAS_2024_ANDROID_PUBLIC_KEY,
    note: "Sovran's Christmas Giveaway 🎁",
    condition: () => Platform.OS === 'android',
    error: () =>
      Platform.OS !== 'android' && {
        title: 'Not redeemable on iOS',
        message:
          'This ecash token is part of our Android Christmas giveaway and is only redeemable on that platform.',
      },
  },
};
