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
  /**
   * How the route presents when opened with `entry=sheet`
   * (`buildModalProfileHref`): on iPhone a page that follows a sheet would be
   * pushed beneath it, so a page opened from a sheet becomes a sheet too.
   */
  sheet?: Omit<ModalConfig, 'name' | 'sheet'>;
}

/**
 * Android sheet presentation: a native bottom sheet (react-native-screens
 * formSheet, Material BottomSheetBehavior) at full height — drag-to-dismiss,
 * dim scrim, rounded top corners. The closest Android analog of the iOS
 * pageSheet card. Used only by the single-screen routes
 * `androidFlowPresentation` names; every flow stack is a pushed screen there.
 *
 * No native header renders inside an Android formSheet (RNS #2657, not fixed
 * in any 4.x), so everything here carries `headerShown: false` and the route
 * file draws the chrome instead: FormSheetChrome, or the prompt's own page.
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
 * A flow group hosting a nested stack (`FlowStack`). iOS: a page sheet whose
 * steps push inside it. Android: a pushed screen, entered with a horizontal
 * slide and left with Back (ADR 0025); its nested stack draws the native header.
 */
const modalFlow = (name: string): ModalConfig => ({
  name,
  options:
    Platform.OS !== 'android'
      ? { presentation: 'modal', headerShown: false }
      : { presentation: 'card', headerShown: false, animation: 'slide_from_right' },
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

const flowGroups = ['(receive-flow)', '(send-flow)', '(mint-flow)'].map((name) => modalFlow(name));

/**
 * A prompt, which draws everything itself: a page sheet on iPhone, a bottom
 * sheet on Android (`androidFlowPresentation`).
 */
const promptSheet = (name: string): ModalConfig => ({
  name,
  options:
    Platform.OS === 'android' && androidFlowPresentation(name) === 'sheet'
      ? ANDROID_SHEET_OPTIONS
      : { presentation: 'modal', headerShown: false },
});

/**
 * A page pushed onto the root stack, with the native header and its back
 * button (the app's on Android); `headerShown: false` for the pages that draw
 * their own. Opened with `entry=sheet` it is the page sheet on iPhone instead.
 */
const pushedPage = (name: string, title?: string, ownHeader = false): ModalConfig => {
  const header = ownHeader ? { headerShown: false } : GRADIENT_HEADER_OPTIONS;
  return {
    name,
    ...(title && { title }),
    androidPushed: !ownHeader && Platform.OS === 'android',
    options: { presentation: 'card', animation: 'slide_from_right', ...header },
    ...(Platform.OS === 'ios' && {
      sheet: { ...(title && { title }), options: { presentation: 'modal', ...header } },
    }),
  };
};

const standaloneScreens: ModalConfig[] = [
  slideFromRight('(settings-flow)'),
  // A prompt, and the backup journey "Back up now" opens over it: on iPhone
  // each page a sheet over the last, on Android pushed pages. Leaving the
  // journey closes them all (features/backup/lib/journey.ts).
  promptSheet('cta'),
  promptSheet('cta-sample'),
  modalWithGradient('backup-intro', 'modal'),
  modalWithGradient('backup-words', 'modal'),
  modalWithGradient('backup-verify', 'modal'),
  modalWithGradient('backup-done', 'modal'),
  // A Nostr profile and the BitChat pages it leads to.
  pushedPage('profile', 'Profile'),
  pushedPage('geohashChat', undefined, true),
  pushedPage('bitchatNetwork', undefined, true),
  pushedPage('bitchatDM', undefined, true),
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
