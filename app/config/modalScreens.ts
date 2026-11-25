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
 * A short "pick one of N" list, as a sheet over the screen that asked for it
 * (ADR 0026). On iPhone a system form sheet: it rises to a little over half
 * height with a grabber, grows to full height when pulled or scrolled, and is
 * dismissed by pulling down, so the screen underneath stays in view. Android
 * keeps a pushed page (ADR 0025), so there is nothing to add there. Select
 * mint and the `picker` route both use it.
 */
export const PICKER_SHEET_OPTIONS: Partial<NativeStackNavigationOptions> =
  Platform.OS === 'ios'
    ? {
        presentation: 'formSheet',
        sheetAllowedDetents: [0.62, 1],
        sheetGrabberVisible: true,
        sheetCornerRadius: 28,
        sheetExpandsWhenScrolledToEdge: true,
      }
    : {};

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
 * Standalone single-screen route. iOS: pageSheet/formSheet with material blur
 * header, or the picker sheet's geometry for `picker`. Android: a pushed
 * screen with the native header, or a native bottom sheet for the routes
 * `androidFlowPresentation` names.
 */
const modalWithGradient = (
  name: string,
  presentation: 'modal' | 'formSheet' | 'picker',
  title?: string
): ModalConfig => {
  const config = { name, ...(title && { title }) };
  if (Platform.OS !== 'android') {
    const sheet = presentation === 'picker' ? PICKER_SHEET_OPTIONS : { presentation };
    return { ...config, options: { ...sheet, ...GRADIENT_HEADER_OPTIONS } };
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

const flowGroups = ['(receive-flow)', '(send-flow)', '(prompt-flow)', '(mint-flow)', '(profile-flow)'].map(
  (name) => modalFlow(name)
);

const standaloneScreens: ModalConfig[] = [
  slideFromRight('(settings-flow)'),
  slideFromRight('(user-flow)'),
  modalTransparent('camera', 'Scan QR'),
  modalWithGradient('share', 'formSheet'),
  // Every fact about one payment, under the same header as every other
  // standalone screen: the page sheet with a close button on iPhone, a pushed
  // page with the back button on Android.
  modalWithGradient('details', 'modal', 'Details'),
  // Choosing one of several things, opened by `openPicker`: the same sheet as
  // Select mint on iPhone, a pushed page with the back button on Android.
  modalWithGradient('picker', 'picker'),
  // An emoji, picked from a grid with search: the same sheet, opened by
  // `openEmojiPicker`.
  modalWithGradient('emojiPicker', 'picker', 'Emoji'),
  // The ecash held at one mint, picked by hand from the amount screen.
  modalWithGradient('notes', 'modal', 'Pick notes'),
  modalWithGradient('lightningSend', 'modal', railHeaderTitle('lightningSend')),
  modalWithGradient('onchainSend', 'modal', railHeaderTitle('onchainSend')),
  modalWithGradient('receiveToken', 'modal', railHeaderTitle('ecashReceive')),
  modalWithGradient('lightningReceive', 'modal', railHeaderTitle('lightningReceive')),
  modalWithGradient('onchainReceive', 'modal', railHeaderTitle('onchainReceive')),
  modalWithGradient('paymentRequest', 'modal', railHeaderTitle('ecashReceive')),
  modalWithGradient('sendToken', 'modal', railHeaderTitle('ecashSend')),
  // Transaction history. Each row opens its payment's detail route above
  // (marked `historyView=1`), as a sheet over the list on iPhone and a pushed
  // page on Android; the filters are a sheet on both.
  modalWithGradient('transactions', 'modal'),
  modalWithGradient('filters', 'modal', 'Filters'),
  modalWithGradient('swap', 'modal', railHeaderTitle('swap')),
  modalWithGradient('aiRequest', 'modal', 'AI request'),
  // The merchant map, and one merchant over it.
  modalWithGradient('map', 'modal', 'Bitcoin map'),
  modalWithGradient('detail', 'modal', 'Merchant details'),
  // The wallpaper picker: the preview, then a background or the gallery over it.
  modalWithGradient('preview', 'modal', 'Theme preview'),
  modalWithGradient('background', 'modal', 'Background'),
  modalWithGradient('gallery', 'modal', 'Gallery'),
  cardFade('claimUsername', {
    headerShadowVisible: false,
    headerTitle: '',
    headerBackVisible: false,
    headerBlurEffect: 'none',
    headerBackground: () => null,
  }),
];

export const MODAL_SCREENS: ModalConfig[] = [...flowGroups, ...standaloneScreens];
