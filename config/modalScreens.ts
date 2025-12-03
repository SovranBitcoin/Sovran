import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export interface ModalConfig {
  name: string;
  title?: string;
  options?: NativeStackNavigationOptions;
}

export const MODAL_SCREENS: ModalConfig[] = [
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
  // Filter flow modal group - transaction filters
  {
    name: '(filter-flow)',
    options: {
      presentation: 'modal',
      headerShown: false,
      gestureDirection: 'vertical',
    },
  },
  // Map flow modal group - Bitcoin merchant map
  // Using 'modal' instead of 'fullScreenModal' for faster animation
  {
    name: '(map-flow)',
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
      headerBackButtonDisplayMode: 'minimal',
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
      headerBackButtonDisplayMode: 'minimal',
    },
  },
  {
    name: 'debugModal',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackButtonDisplayMode: 'minimal',
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
      headerBackButtonDisplayMode: 'minimal',
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
      headerBackButtonDisplayMode: 'minimal',
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
      headerBackButtonDisplayMode: 'minimal',
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
  {
    name: 'settings-pages/keyring',
    title: 'P2PK Keys',
  },
  {
    name: 'sendToken',
    title: 'Send Ecash',
    options: {
      presentation: 'modal',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackButtonDisplayMode: 'minimal',
      gestureDirection: 'vertical',
    },
  },
  {
    name: 'claimUsername',
    options: {
      presentation: 'formSheet',
      headerShown: true,
      headerBlurEffect: 'systemMaterial',
      headerTransparent: true,
      headerBackButtonDisplayMode: 'minimal',
      gestureDirection: 'vertical',
    },
  },
];
