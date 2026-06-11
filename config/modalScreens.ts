import { Platform } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export interface ModalConfig {
  name: string;
  title?: string;
  options?: NativeStackNavigationOptions;
}

const BLUR_HEADER_OPTIONS = {
  headerBlurEffect: 'systemMaterial' as const,
  headerTransparent: true,
  headerBackButtonDisplayMode: 'minimal' as const,
} satisfies Partial<NativeStackNavigationOptions>;

/**
 * Android presentation for the standalone single-screen modals: a native
 * bottom sheet (react-native-screens formSheet, Material BottomSheetBehavior)
 * at full height — drag-to-dismiss, dim scrim, rounded top corners. The
 * closest Android analog of the iOS pageSheet card.
 *
 * The nine flow GROUPS stay fullscreen `modal` on Android on purpose: nested
 * stacks inside an Android formSheet render no native headers (RNS #2657 —
 * not fixed in any 4.x) and nested ScrollViews still fight the
 * scroll-to-dismiss gesture (#2693). Single-screen modals have neither
 * problem.
 *
 * No native header renders inside an Android formSheet either, so these
 * screens get `headerShown: false` and their route files render
 * FormSheetChrome (grabber + title + close) instead. sheetGrabberVisible /
 * sheetCornerRadius are iOS-only props — Android draws its own sheet corners.
 */
const ANDROID_SHEET_OPTIONS = {
  presentation: 'formSheet' as const,
  sheetAllowedDetents: [1.0],
  sheetInitialDetentIndex: 0 as const,
  sheetElevation: 24,
  headerShown: false,
} satisfies Partial<NativeStackNavigationOptions>;

/** Card: default stack presentation. */
const card = (name: string): ModalConfig => ({ name });

/** Modal flow: slides up from bottom, nested layout handles headers. */
const modalFlow = (name: string): ModalConfig => ({
  name,
  options: {
    presentation: 'modal',
    headerShown: false,
  },
});

/** Slide from right: nested layout handles headers, horizontal slide animation. */
const slideFromRight = (name: string, presentation: 'modal' | 'card' = 'card'): ModalConfig => ({
  name,
  options: {
    presentation,
    headerShown: false,
    animation: 'slide_from_right',
  },
});

/**
 * Standalone single-screen modal. iOS: pageSheet/formSheet with material blur
 * header (unchanged). Android: native bottom sheet (see ANDROID_SHEET_OPTIONS).
 */
const modalWithBlur = (
  name: string,
  presentation: 'modal' | 'formSheet',
  title?: string
): ModalConfig => ({
  name,
  ...(title && { title }),
  options:
    Platform.OS === 'android'
      ? ANDROID_SHEET_OPTIONS
      : {
          presentation,
          ...BLUR_HEADER_OPTIONS,
        },
});

/** Card with fade: for shared-element transitions. */
const cardFade = (
  name: string,
  overrides?: Partial<NativeStackNavigationOptions> & { title?: string }
): ModalConfig => {
  const { title, ...opts } = overrides ?? {};
  return {
    name,
    ...(title && { title }),
    options: {
      animation: 'fade',
      headerTransparent: true,
      ...opts,
    },
  };
};

/** Full-screen modal: no header, optional content style. */
const fullScreenModal = (
  name: string,
  overrides?: Partial<NativeStackNavigationOptions>
): ModalConfig => ({
  name,
  options: {
    presentation: 'fullScreenModal',
    headerShown: false,
    ...overrides,
  },
});

const TRANSPARENT_HEADER_OPTIONS = {
  headerTransparent: true,
  headerStyle: { backgroundColor: 'transparent' as const },
  headerBackButtonDisplayMode: 'minimal' as const,
} satisfies Partial<NativeStackNavigationOptions>;

/** Modal with transparent header (no blur). */
const modalTransparent = (name: string, title?: string): ModalConfig => ({
  name,
  ...(title && { title }),
  options: {
    presentation: 'modal',
    ...TRANSPARENT_HEADER_OPTIONS,
  },
});

const flowGroups = [
  '(receive-flow)',
  '(send-flow)',
  '(transactions-flow)',
  '(mint-flow)',
  '(filter-flow)',
  '(map-flow)',
  '(split-bill-flow)',
  '(theme-flow)',
  '(profile-flow)',
].map(modalFlow);

const standaloneScreens: ModalConfig[] = [
  card('userMessages'),
  slideFromRight('(settings-flow)'),
  slideFromRight('(user-flow)'),
  fullScreenModal('(stories-flow)', { contentStyle: { backgroundColor: '#000' } }),
  modalTransparent('camera', 'Scan QR'),
  modalWithBlur('share', 'formSheet'),
  modalWithBlur('lightningSend', 'modal', 'Send Lightning'),
  modalWithBlur('onchainSend', 'modal', 'Send Onchain'),
  modalWithBlur('meltQuote', 'modal', 'Send Lightning'),
  modalWithBlur('receiveToken', 'modal', 'Receive Ecash'),
  modalWithBlur('lightningReceive', 'modal', 'Receive Lightning'),
  modalWithBlur('onchainReceive', 'modal', 'Receive Onchain'),
  modalWithBlur('mintQuote', 'modal', 'Receive Lightning'),
  modalWithBlur('sendToken', 'modal', 'Send Ecash'),
  cardFade('claimUsername', {
    headerShadowVisible: false,
    headerTitle: '',
    headerBackVisible: false,
    headerBlurEffect: 'none',
    headerBackground: () => null,
  }),
];

export const MODAL_SCREENS: ModalConfig[] = [...flowGroups, ...standaloneScreens];
