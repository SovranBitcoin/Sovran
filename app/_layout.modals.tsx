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
    name: 'settings-pages/about',
    title: 'About',
  },
  {
    name: 'settings-pages/design',
    title: 'Design',
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
