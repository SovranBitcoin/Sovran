import React from 'react';
import { View } from 'react-native';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';

// Screen imports
import HomeView from 'app/(drawer)/(tabs)/index';
import LifestyleView from 'app/(drawer)/(tabs)/lifestyle';
import PaymentsView from 'app/(drawer)/(tabs)/payments';
import { LinearGradient } from 'expo-linear-gradient';

// Tab configuration
interface TabConfig {
  name: string;
  component: React.ComponentType<any>;
  title: string;
  icon: React.ComponentType<{ focused: boolean; theme: Theme }>;
  condition?: boolean;
}

// Constants
const LIGHT_THEMES = ['light', 'beige'];

// Helper functions
const isLightTheme = (theme: Theme) => LIGHT_THEMES.includes(theme.id);
const getBlurTint = (theme: Theme) => (isLightTheme(theme) ? 'light' : 'dark');
const getBlurIntensity = (theme: Theme) => (isLightTheme(theme) ? 7.5 : 75);

// Tab screens configuration
export const TAB_SCREENS = (): TabConfig[] => [
  {
    name: 'payments',
    component: PaymentsView,
    title: 'Payments',
    icon: ({ focused, theme }) => (
      <Icon
        name="fluent:arrow-swap-16-filled"
        color={focused ? theme.shades[300] : opacity(greys(theme)[50], 0.25)}
        size={32}
      />
    ),
  },
  {
    name: 'index',
    component: HomeView,
    title: 'Wallet',
    icon: ({ focused, theme }) => (
      <View style={{ position: 'relative', width: 64, height: 64 }}>
        <View className="absolute h-5 overflow-hidden" style={{ width: 100, bottom: 51 }}>
          <BlurView
            tint={getBlurTint(theme)}
            intensity={getBlurIntensity(theme)}
            experimentalBlurMethod="dimezisBlurView"
            className="absolute overflow-hidden rounded-full"
            style={{
              top: 6,
              left: 0,
              backgroundColor: opacity(greys(theme)[900], 0.5),
              zIndex: -2,
              width: 64,
              height: 64,
            }}
          />
        </View>

        <LinearGradient
          colors={[greys(theme)[focused ? 0 : 600], greys(theme)[focused ? 100 : 700]]}
          style={{
            position: 'absolute',
            width: 52,
            height: 52,
            borderRadius: 100,
            justifyContent: 'center',
            alignItems: 'center',
            top: 6,
            left: 6,
          }}>
          <Icon name="mingcute:lightning-fill" color={focused ? 'black' : 'white'} size={20} />
        </LinearGradient>
      </View>
    ),
  },
  {
    name: 'lifestyle',
    component: LifestyleView,
    title: '',
    icon: ({ focused, theme }) => (
      <Icon
        name="clarity:internet-of-things-solid"
        color={focused ? theme.shades[300] : opacity(greys(theme)[50], 0.25)}
        size={32}
        spin={{
          duration: 2000,
          delay: 4000,
          outputRange: ['0deg', '120deg'],
        }}
      />
    ),
  },
];

// Tab configuration
interface ModalConfig {
  name: string;
  title?: string;
  options?: any;
}

export const MODAL_SCREENS: ModalConfig[] = [
  {
    name: 'TabLayout',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'notifications',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'feed',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'contacts',
  },
  {
    name: 'userMessages',
    options: {
      presentation: 'card',
    },
  },
  {
    name: 'currency',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'receive',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'camera',
    options: {},
  },
  {
    name: 'passcode',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'backup',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'profile',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'profileShare',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'lightningSendConfirmation',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'ecashReceiveConfirmation',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'lightningReceiveConfirmation',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'onboard',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'post',
    options: {
      presentation: 'card',
      fullScreenGestureEnabled: true,
    },
  },
];

export const MODAL_SCREENS_ALT: ModalConfig[] = [
  {
    name: 'bitrefill',
    title: 'Gift Cards',
  },
  {
    name: 'onboard/welcome',
    title: '',
  },
  {
    name: 'onboard/displayMnemonic',
    title: '',
  },
  {
    name: 'onboard/mnemonic',
    title: '',
  },
  {
    name: 'onboard/new',
    title: '',
  },
  {
    name: 'onboard/animate',
    title: 'Loading...',
  },
  {
    name: 'onboard/restore',
    title: '',
  },
  {
    name: 'onboard/nsec',
    title: '',
  },
  {
    name: 'onboard/ecash',
    title: '',
  },
  {
    name: 'onboard/go',
    title: '',
  },
  {
    name: 'onboard/recover',
    title: '',
  },
  {
    name: 'onboard/nostr',
    title: '',
  },
  {
    name: 'onboard/restoreChoice',
    title: '',
  },
  {
    name: 'giftcards/all',
    title: 'Gift cards',
    options: {
      headerLargeTitle: true,
    },
  },
  {
    name: 'giftcards/giftcard',
    options: {
      headerLargeTitle: true,
    },
  },
  {
    name: 'settings-pages',
    title: 'Settings',
  },
  {
    name: 'settings-pages/about',
    title: 'About',
  },
  {
    name: 'settings-pages/design',
    title: 'Design',
  },
  {
    name: 'settings-pages/store',
    title: 'Store',
  },
  {
    name: 'settings-pages/restoreCounter',
    title: 'Restore Counter',
  },
  {
    name: 'settings-pages/proofs',
    title: 'Check Proofs',
  },
  {
    name: 'settings-pages/terms',
    title: 'Terms & Conditions',
  },
  {
    name: 'settings-pages/passcode',
    title: 'Passcode',
  },
  {
    name: 'settings-pages/profile',
    title: 'Profile',
  },
  {
    name: 'transactions',
    title: 'Transactions',
    options: {
      headerLargeTitle: true,
    },
  },
  {
    name: 'donate/donate',
    title: 'Donate',
    options: {
      headerLargeTitle: true,
    },
  },
  {
    name: 'transaction',
    title: '',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'settings-pages/language',
    title: 'Language',
  },
  {
    name: 'settings-pages/theme',
    title: 'Theme',
  },
  {
    name: 'backgroundImageSettings',
    title: 'Background Image',
  },
  {
    name: 'ecashSendConfirmation',
    title: 'Send Ecash',
    options: {
      presentation: 'modal',
    },
  },
];
