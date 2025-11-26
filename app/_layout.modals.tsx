export interface ModalConfig {
  name: string;
  title?: string;
  options?: {
    presentation?: 'modal' | 'card' | 'formSheet';
    headerShown?: boolean;
    headerLargeTitle?: boolean;
    fullScreenGestureEnabled?: boolean;
    headerBlurEffect?: 'regular' | 'prominent' | 'systemMaterial' | 'systemUltraThinMaterial';
    headerTransparent?: boolean;
    headerBackTitleVisible?: boolean;
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
  // Receive flow modal group - slides up as a modal, internal screens push horizontally
  {
    name: '(receive-flow)',
    options: {
      presentation: 'formSheet',
      headerShown: false, // The nested layout handles headers
      animation: 'slide_from_bottom', // Ensure it slides up
    },
  },
  // Send flow modal group - slides up as a modal, internal screens push horizontally
  {
    name: '(send-flow)',
    options: {
      presentation: 'formSheet',
      headerShown: false, // The nested layout handles headers
      animation: 'slide_from_bottom', // Ensure it slides up
    },
  },
  // Transactions flow modal group - slides up as a modal, internal screens push horizontally
  {
    name: '(transactions-flow)',
    options: {
      presentation: 'formSheet',
      headerShown: false, // The nested layout handles headers
      animation: 'slide_from_bottom', // Ensure it slides up like other modals
    },
  },
  // Mint flow modal group - mint selection, add, info
  {
    name: '(mint-flow)',
    options: {
      presentation: 'formSheet',
      headerShown: false, // The nested layout handles headers
      animation: 'slide_from_bottom',
    },
  },
  // Standalone currency screen (for direct navigation from other flows)
  {
    name: 'currency',
    title: 'Select Amount',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
  // Standalone receive screen (for deep linking)
  {
    name: 'receive',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
  {
    name: 'camera',
  },
  {
    name: 'share',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
  {
    name: 'meltQuote',
    title: 'Send Lightning',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
  {
    name: 'receiveToken',
    title: 'Receive Ecash',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
  {
    name: 'mintQuote',
    title: 'Receive Lightning',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
  {
    name: 'settings-pages/index',
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
  // Standalone Transactions (for deep linking)
  {
    name: 'transactions',
    title: 'Transactions',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
      animation: 'slide_from_bottom',
    },
  },
  {
    name: 'sendToken',
    title: 'Send Ecash',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
    },
  },
];
