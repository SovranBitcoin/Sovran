export interface ModalConfig {
  name: string;
  title?: string;
  options?: {
    presentation?:
      | 'modal'
      | 'card'
      | 'formSheet'
      | 'containedModal'
      | 'fullScreenModal'
      | 'containedTransparentModal'
      | 'transparentModal';
    headerShown?: boolean;
    headerLargeTitle?: boolean;
    fullScreenGestureEnabled?: boolean;
    headerBlurEffect?: 'regular' | 'prominent' | 'systemMaterial' | 'systemUltraThinMaterial';
    headerTransparent?: boolean;
    headerBackTitleVisible?: boolean;
    gestureDirection?: 'horizontal' | 'vertical' | 'horizontal-inverted' | 'vertical-inverted';
    animation?:
      | 'default'
      | 'fade'
      | 'fade_from_bottom'
      | 'flip'
      | 'none'
      | 'simple_push'
      | 'slide_from_bottom'
      | 'slide_from_right'
      | 'slide_from_left'
      | 'ios_from_right'
      | 'ios_from_left';
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
      presentation: 'modal', // Modal presentation - slides up from bottom
      headerShown: false, // The nested layout handles headers
      gestureDirection: 'vertical', // Swipe down to dismiss
    },
  },
  // Send flow modal group - slides up as a modal, internal screens push horizontally
  {
    name: '(send-flow)',
    options: {
      presentation: 'modal',
      headerShown: false,
      gestureDirection: 'vertical',
    },
  },
  // Transactions flow modal group - slides up as a modal, internal screens push horizontally
  {
    name: '(transactions-flow)',
    options: {
      presentation: 'modal',
      headerShown: false,
      gestureDirection: 'vertical',
    },
  },
  // Mint flow modal group - mint selection, add, info
  {
    name: '(mint-flow)',
    options: {
      presentation: 'modal',
      headerShown: false,
      gestureDirection: 'vertical',
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
      presentation: 'modal',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
      gestureDirection: 'vertical',
    },
  },
  {
    name: 'receiveToken',
    title: 'Receive Ecash',
    options: {
      presentation: 'modal',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
      gestureDirection: 'vertical',
    },
  },
  {
    name: 'mintQuote',
    title: 'Receive Lightning',
    options: {
      presentation: 'modal',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
      gestureDirection: 'vertical',
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
      presentation: 'modal',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackTitleVisible: false,
      gestureDirection: 'vertical',
    },
  },
];
