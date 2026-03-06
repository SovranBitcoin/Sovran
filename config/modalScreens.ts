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

/** Modal or form sheet with material blur header. */
const modalWithBlur = (
  name: string,
  presentation: 'modal' | 'formSheet',
  title?: string
): ModalConfig => ({
  name,
  ...(title && { title }),
  options: {
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
].map(modalFlow);

const standaloneScreens: ModalConfig[] = [
  card('userMessages'),
  slideFromRight('(settings-flow)'),
  slideFromRight('(user-flow)'),
  fullScreenModal('(stories-flow)', { contentStyle: { backgroundColor: '#000' } }),
  cardFade('healthModal'),
  cardFade('pendingEcash', {
    title: 'Pending Ecash',
    headerBackButtonDisplayMode: 'minimal',
  }),
  modalWithBlur('currency', 'formSheet', 'Select Amount'),
  modalTransparent('camera', 'Scan QR'),
  modalWithBlur('share', 'formSheet'),
  modalWithBlur('meltQuote', 'modal', 'Send Lightning'),
  modalWithBlur('receiveToken', 'modal', 'Receive Ecash'),
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
