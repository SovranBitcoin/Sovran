/**
 * @jest-environment node
 */

jest.mock('react-native-web/dist/exports/Keyboard', () => ({
  __esModule: true,
  default: {
    isVisible: jest.fn(() => false),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    dismiss: jest.fn(),
    removeAllListeners: jest.fn(),
    removeListener: jest.fn(),
  },
}));
jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: 'BottomSheetScrollView',
  BottomSheetTextInput: 'BottomSheetTextInput',
}));
jest.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));
jest.mock('heroui-native', () => ({
  BottomSheet: { Title: 'BottomSheet.Title' },
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn((color: string, value: number) => `${color}:${value}`),
}));
jest.mock('nostr-tools/nip19', () => ({
  nprofileEncode: jest.fn(({ pubkey }: { pubkey: string }) => `nprofile:${pubkey}`),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('assets/icons', () => 'Icon', { virtual: true });
jest.mock('@/features/payments/hooks/useContactSearch', () => ({
  CONTACT_SEARCH_MIN_LENGTH: 3,
  useContactSearch: jest.fn(() => ({
    displayResults: [],
    searchLoading: false,
    hasSearched: false,
    showNoResults: false,
  })),
}));
jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: 'ContactRow',
  nostrIdentity: jest.fn((pubkey, profile, opts) => ({ kind: 'nostr', pubkey, profile, ...opts })),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: jest.fn(() => [
    'foreground',
    'background',
    'muted',
    'mutedForeground',
    'border',
    'accent',
  ]),
}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadataMany: jest.fn(() => ({
    metadata: new Map(),
    isLoading: false,
  })),
}));
jest.mock('@/shared/lib/popup/popups/bridge', () => ({ showActionSheet: jest.fn() }));

const dismissKeyboard = require('react-native-web/dist/exports/Keyboard').default
  .dismiss as jest.Mock;
const { getSendMemoMentionPanelHeight, submitSendMemo } =
  require('@/shared/lib/popup/popups/sendMemoSheet') as {
    getSendMemoMentionPanelHeight: (params: {
      windowHeight: number;
      insetTop: number;
      keyboardHeight: number;
      chromeHeight: number;
    }) => number;
    submitSendMemo: (machine: { submitSendMemo: jest.Mock }, memo: string | undefined) => void;
  };

describe('send memo sheet submit helper', () => {
  beforeEach(() => {
    dismissKeyboard.mockClear();
  });

  it('trims non-empty memo text before submitting', () => {
    const machine = { submitSendMemo: jest.fn(async () => {}) };

    submitSendMemo(machine as never, '  lunch  ');

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(machine.submitSendMemo).toHaveBeenCalledWith('lunch');
  });

  it('submits undefined for blank memo text', () => {
    const machine = { submitSendMemo: jest.fn(async () => {}) };

    submitSendMemo(machine as never, '   ');

    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(machine.submitSendMemo).toHaveBeenCalledWith(undefined);
  });
});

describe('send memo mention panel sizing', () => {
  it('uses the full sheet space when the keyboard is hidden', () => {
    expect(
      getSendMemoMentionPanelHeight({
        windowHeight: 800,
        insetTop: 40,
        keyboardHeight: 0,
        chromeHeight: 88,
      })
    ).toBe(600);
  });

  it('sizes the result panel inside the visible keyboard space', () => {
    expect(
      getSendMemoMentionPanelHeight({
        windowHeight: 800,
        insetTop: 40,
        keyboardHeight: 300,
        chromeHeight: 88,
      })
    ).toBe(300);
  });
});
