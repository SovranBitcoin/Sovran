import { railHeaderTitle } from 'wallet';

import { GRADIENT_HEADER_OPTIONS } from '@/navigation/headerOptions';
import { Platform } from 'react-native';
import { androidFlowPresentation } from './androidFlowPresentation';
import type { NativeStackNavigationOptions } from 'expo-router';

export interface ModalConfig {
  name: string;
  title?: string;
  options?: NativeStackNavigationOptions;
  /**
   * Android presents this route as a pushed screen with the native header, so
   * the root stack gives it the app's back button in place of the system one.
   */
  androidPushed?: boolean;
}

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
 * sheetGrabberVisible is iOS-only (the JS chrome draws the grabber);
 * sheetCornerRadius IS cross-platform — unset it clamps to 0 on Android
 * (RNS Screen.kt default -1 → max(...,0)), which rendered SQUARE sheet
 * corners.
 */
const ANDROID_SHEET_OPTIONS = {
  presentation: 'formSheet' as const,
  sheetAllowedDetents: [1.0],
  sheetInitialDetentIndex: 0 as const,
  sheetElevation: 24,
  // Rounded top corners via RNS's MaterialShapeDrawable — matches the app's
  // card radius and the iOS sheet look.
  sheetCornerRadius: 24,
  headerShown: false,
} satisfies Partial<NativeStackNavigationOptions>;

/**
 * Modal flow hosting a nested stack. iOS: fullscreen pageSheet-style modal.
 * Android: a pushed screen, or a native bottom sheet for the few flows
 * `androidFlowPresentation` names. The flow's `_layout` renders
 * `AndroidSheetFlowStack` with the same flow name, which picks the matching
 * chrome, so the two can never disagree.
 */
const modalFlow = (name: string): ModalConfig => ({
  name,
  options:
    Platform.OS !== 'android'
      ? { presentation: 'modal', headerShown: false }
      : androidFlowPresentation(name) === 'sheet'
        ? ANDROID_SHEET_OPTIONS
        : // A pushed screen: entered with a horizontal slide, left with Back.
          // The flow's own nested stack draws the native header.
          { presentation: 'card', headerShown: false, animation: 'slide_from_right' },
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
 * Slide from bottom: full-screen modal that rises vertically on both iOS and
 * Android. For self-contained screens that draw their own chrome (header,
 * safe-area insets) and want the keyboard to animate up from the bottom rather
 * than be dragged in alongside a horizontal slide. The screen owns its
 * background, so no contentStyle is set here.
 */
const slideFromBottom = (name: string): ModalConfig => ({
  name,
  options: {
    presentation: 'fullScreenModal',
    headerShown: false,
    animation: 'slide_from_bottom',
  },
});

/**
 * Standalone single-screen route. iOS: pageSheet/formSheet with material blur
 * header. Android: a pushed screen with the native header, or a native bottom
 * sheet for the routes `androidFlowPresentation` names.
 */
const modalWithGradient = (
  name: string,
  presentation: 'modal' | 'formSheet',
  title?: string
): ModalConfig => {
  const config = { name, ...(title && { title }) };
  if (Platform.OS !== 'android') {
    return { ...config, options: { presentation, ...GRADIENT_HEADER_OPTIONS } };
  }
  if (androidFlowPresentation(name) === 'sheet') {
    return { ...config, options: ANDROID_SHEET_OPTIONS };
  }
  return {
    ...config,
    androidPushed: true,
    options: { presentation: 'card', animation: 'slide_from_right', ...GRADIENT_HEADER_OPTIONS },
  };
};

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
  '(prompt-flow)',
  '(mint-flow)',
  '(ai-flow)',
  '(filter-flow)',
  '(map-flow)',
  '(theme-flow)',
  '(profile-flow)',
].map((name) => modalFlow(name));

const standaloneScreens: ModalConfig[] = [
  // DM thread: headerShown must be statically true — DmChatHeader only swaps
  // header CONTENT. A false→true flip while the send-flow modal is dismissing
  // makes react-native-screens remount the screen in a loop (blank DM thread).
  { name: 'userMessages', options: { headerShown: true } },
  slideFromBottom('composer'),
  slideFromRight('(settings-flow)'),
  slideFromRight('(signer-flow)'),
  slideFromRight('(user-flow)'),
  fullScreenModal('(stories-flow)', { contentStyle: { backgroundColor: '#000' } }),
  modalTransparent('camera', 'Scan QR'),
  modalWithGradient('share', 'formSheet'),
  // Every fact about one payment, under the same header as every other
  // standalone screen: the page sheet with a close button on iPhone, a pushed
  // page with the back button on Android.
  modalWithGradient('details', 'modal', 'Details'),
  // The ecash held at one mint, picked by hand from the amount screen.
  modalWithGradient('notes', 'modal', 'Pick notes'),
  modalWithGradient('lightningSend', 'modal', railHeaderTitle('lightningSend')),
  modalWithGradient('onchainSend', 'modal', railHeaderTitle('onchainSend')),
  modalWithGradient('receiveToken', 'modal', railHeaderTitle('ecashReceive')),
  modalWithGradient('lightningReceive', 'modal', railHeaderTitle('lightningReceive')),
  modalWithGradient('onchainReceive', 'modal', railHeaderTitle('onchainReceive')),
  modalWithGradient('paymentRequest', 'modal', railHeaderTitle('ecashReceive')),
  modalWithGradient('sendToken', 'modal', railHeaderTitle('ecashSend')),
  cardFade('claimUsername', {
    headerShadowVisible: false,
    headerTitle: '',
    headerBackVisible: false,
    headerBlurEffect: 'none',
    headerBackground: () => null,
  }),
];

export const MODAL_SCREENS: ModalConfig[] = [...flowGroups, ...standaloneScreens];
