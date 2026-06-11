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
 * Android sheet presentation: a native bottom sheet (react-native-screens
 * formSheet, Material BottomSheetBehavior) at full height — drag-to-dismiss,
 * dim scrim, rounded top corners. The closest Android analog of the iOS
 * pageSheet card. Used by the standalone single-screen modals AND the flow
 * groups (modalFlow).
 *
 * No native header renders inside an Android formSheet (RNS #2657, not fixed
 * in any 4.x), so everything here carries `headerShown: false` and the JS
 * side draws the chrome instead: standalone route files wrap their screens in
 * FormSheetChrome; flow groups' nested stacks render FlowSheetHeader via
 * createFlowLayoutScreenOptions({...}, { androidSheet: true }).
 * sheetGrabberVisible / sheetCornerRadius are iOS-only props — Android draws
 * its own sheet corners and the JS chrome draws the grabber.
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

/**
 * Modal flow hosting a nested stack. iOS: fullscreen pageSheet-style modal
 * (unchanged). Android: native bottom sheet — requires the flow's _layout to
 * pass { androidSheet: true } to createFlowLayoutScreenOptions so the nested
 * stack renders the JS FlowSheetHeader (native headers don't exist inside
 * Android formSheets). Opting a flow out is the two co-located lines:
 * `modalFlow('(x-flow)', { androidSheet: false })` here + `{ androidSheet:
 * false }` in its _layout — that reverts it to today's fullscreen modal.
 */
const modalFlow = (
  name: string,
  { androidSheet = true }: { androidSheet?: boolean } = {}
): ModalConfig => ({
  name,
  options:
    Platform.OS === 'android' && androidSheet
      ? ANDROID_SHEET_OPTIONS
      : {
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
].map((name) => modalFlow(name));

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
