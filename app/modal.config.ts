export interface ModalConfig {
  name: string;
  title?: string;
  options?: {
    presentation?: 'modal' | 'card';
    headerShown?: boolean;
    headerLargeTitle?: boolean;
    fullScreenGestureEnabled?: boolean;
    [key: string]: any;
  };
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
      presentation: 'card',
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
    name: 'share',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'meltQuote',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'receiveToken',
    options: {
      presentation: 'modal',
    },
  },
  {
    name: 'mintQuote',
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
    title: 'Verify Recovery Phrase',
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
    name: 'settings-pages/theme',
    title: 'Theme',
  },
  // Transactions
  {
    name: 'transactions',
    title: 'Transactions',
    options: {
      headerLargeTitle: true,
    },
  },
  {
    name: 'sendToken',
    title: 'Send Ecash',
    options: {
      presentation: 'modal',
    },
  },
];
