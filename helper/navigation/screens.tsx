import React from 'react';

import Icon, { LightningIcon } from 'assets/icons';

// Screen imports
import HomeView from 'app/(drawer)/(tabs)/index';
import LifestyleView, { activationDate } from 'app/(drawer)/(tabs)/lifestyle';
import PaymentsView from 'app/(drawer)/(tabs)/payments';
import MyEsims from 'app/(drawer)/(tabs)/myEsims';
import MyVpns from 'app/(drawer)/(tabs)/myVpns';

// Tab configuration
interface TabConfig {
  name: string;
  component: React.ComponentType<any>;
  title: string;
  icon: React.ComponentType<{ color: string }>;
  condition?: boolean;
}

// Tab screens configuration
export const TAB_SCREENS = (): TabConfig[] => [
  {
    name: 'payments',
    component: PaymentsView,
    title: 'Payments',
    icon: ({ color }) => <Icon name="fluent:arrow-swap-16-filled" color={color} size={32} />,
  },
  ...(new Date() > activationDate
    ? [
        {
          name: 'myEsims',
          component: MyEsims,
          title: '',
          icon: ({ color }: { color: string }) => (
            <Icon name="fluent:sim-24-filled" color={color} size={32} />
          ),
        },
      ]
    : []),

  {
    name: 'index',
    component: HomeView,
    title: 'Wallet',
    icon: LightningIcon,
  },
  ...(new Date() > activationDate
    ? [
        {
          name: 'myVpns',
          component: MyVpns,
          title: '',
          icon: ({ color }: { color: string }) => (
            <Icon name="ic:baseline-vpn-lock" color={color} size={32} />
          ),
        },
      ]
    : []),
  {
    name: 'lifestyle',
    component: LifestyleView,
    title: '',
    icon: ({ color }) => (
      <Icon
        name="clarity:internet-of-things-solid"
        color={color}
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
    name: 'cards',
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
    name: 'esim',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'esimsDataPlan',
    options: {
      presentation: 'modal',
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
    name: 'esimShare',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'vpnShare',
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
    name: 'vpn',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'esimCountrySelection',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'esimCheckout',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'vpnCheckout',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'vpns',
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
    name: 'settings',
    title: 'Settings',
  },
  {
    name: 'settings/showSeedPhrase',
    title: 'Seed Phrase',
  },
  {
    name: 'settings/about',
    title: 'About',
  },
  {
    name: 'settings/design',
    title: 'Design',
  },
  {
    name: 'settings/store',
    title: 'Store',
  },
  {
    name: 'settings/restoreCounter',
    title: 'Restore Counter',
  },
  {
    name: 'settings/proofs',
    title: 'Check Proofs',
  },
  {
    name: 'settings/terms',
    title: 'Terms & Conditions',
  },
  {
    name: 'settings/customNpub',
    title: 'Custom Lightning URL',
  },
  {
    name: 'settings/verifySeedPhrase',
    title: 'Verify Seed Phrase',
  },
  {
    name: 'settings/passcode',
    title: 'Passcode',
  },
  {
    name: 'settings/profile',
    title: 'Profile',
  },
  {
    name: 'settings/nostrData',
    title: 'Nostr Data',
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
    name: 'languageSettings',
    title: 'Language',
  },
  {
    name: 'themeSettings',
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
