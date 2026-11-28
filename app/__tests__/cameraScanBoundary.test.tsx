/**
 * @jest-environment node
 *
 * Characterization of the camera screen's scan orchestration: a scanned or
 * pasted payload to what the app does with it. The real CameraScreen runs
 * inside the real SovranColadaProvider, so the payment machine, the scan
 * sources and the Sovran step handlers are real; the camera view, the router,
 * the clipboard, the image picker and the manager are replaced. Pinned at what
 * a person sees happen: the route opened, the popup shown, or nothing.
 */

/* eslint-disable import/first */

const mockRouter = {
  navigate: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
  dismissTo: jest.fn(),
  raw: { back: jest.fn() },
};
const mockManagerHolder: { current: unknown } = { current: null };
const mockLayout: { current: Record<string, unknown> | null } = { current: null };
const mockButtons: { current: Record<string, unknown> | null } = { current: null };
const mockAppStateListeners: ((state: string) => void)[] = [];
const mockFocus: { blur: (() => void) | null } = { blur: null };
let mockClipboardText = '';
let mockParams: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => {
  const disk: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => disk[k] ?? null,
      setItem: async (k: string, v: string) => {
        disk[k] = v;
      },
      removeItem: async (k: string) => {
        delete disk[k];
      },
    },
  };
});
jest.mock('@cashu/coco-react', () => ({ useManager: () => mockManagerHolder.current }));
jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useNavigationContainerRef: () => ({ isReady: () => false, getRootState: () => undefined }),
    useSegments: () => [],
    useLocalSearchParams: () => mockParams,
    usePathname: () => '',
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactActual.useEffect(() => {
        const cleanup = effect();
        mockFocus.blur = () => cleanup?.();
        return cleanup ?? undefined;
      }, [effect]);
    },
    router: {},
  };
});
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  get guardedRouter() {
    return mockRouter;
  },
}));
jest.mock('expo-linking', () => ({ useURL: () => null }));
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
  getStringAsync: jest.fn(async () => mockClipboardText),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn(async () => []) }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'white' }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'ab'.repeat(32) } }),
}));
jest.mock('@/runtime/connectivity', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/runtime/WalletProjection', () => ({
  useWalletContextWithOverride: () => mockWallet,
}));
jest.mock('@/features/camera/hooks/useHandleCameraPermission', () => ({
  useHandleCameraPermission: () => ({
    permission: { granted: true },
    handlePermission: async () => true,
  }),
}));
jest.mock('@/features/camera/screens/CameraScreen/CameraLayout', () => ({
  CameraLayout: ({ children, ...props }: { children: React.ReactNode }) => {
    mockLayout.current = props;
    return children;
  },
}));
// Only platform files (index.ios / index.android) exist, which the node preset cannot
// resolve, so the buttons are registered virtually.
jest.mock(
  '@/features/camera/screens/CameraScreen/CameraActionButtons',
  () => ({
    CameraActionButtons: (props: Record<string, unknown>) => {
      mockButtons.current = props;
      return null;
    },
  }),
  { virtual: true }
);
jest.mock('@/shared/lib/nfc', () => ({
  createNfcAdapter: () => undefined,
  writeTokenToNFC: jest.fn(),
  NfcError: class NfcError extends Error {},
  isUserCancelError: () => false,
  nfcReader: () => ({ holder: 'idle' }),
  nfcTapProgressed: jest.fn(),
}));
jest.mock('@/shared/lib/migrations/dataMigrations', () => ({
  runDataMigrations: jest.fn(async () => undefined),
}));
jest.mock('@/features/send/lib/paymentOptionPicker', () => ({
  choosePaymentOption: jest.fn(),
  chooseFallbackPaymentOption: jest.fn(),
}));
jest.mock('@/features/send/lib/proofSelectorPicker', () => ({ chooseProofs: jest.fn() }));
jest.mock('@/features/send/lib/sendFallbackPicker', () => ({ chooseSendFallback: jest.fn() }));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({ actionMenuSheet: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({
  popup: jest.fn(),
  copyPopup: jest.fn(),
  copyTokenAsEmoji: jest.fn(),
  nfcConnectionLostPopup: jest.fn(),
  nfcEcashSharedPopup: jest.fn(),
  nfcSendFailedPopup: jest.fn(),
  paymentCancelledPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));

const mockWallet = {
  trustedMintUrls: ['https://mint1.example.com'],
  mintBalances: { 'https://mint1.example.com': 0 },
  preferredMintUrl: 'https://mint1.example.com',
  proofAmounts: {},
};

import React from 'react';
import { AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { act, render } from '@testing-library/react-native';

import { SovranColadaProvider } from '@/features/send/providers/Colada';
import { CameraScreen } from '@/features/camera/screens/CameraScreen/CameraScreen';
import { popup, staticPopup } from '@/shared/lib/popup';

const TOKEN =
  'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludDEuZXhhbXBsZS5jb20iLCJwcm9vZnMiOlt7ImFtb3VudCI6MSwic2VjcmV0IjoiYWJjIiwiQyI6IjAyYWJjIiwiaWQiOiIwMGFkMjY4YyJ9XX1dLCJ1bml0Ijoic2F0In0=';
const PAIRING = 'nostrconnect://' + 'cd'.repeat(32) + '?relay=wss%3A%2F%2Fr.example&secret=s';

let now = 5_000_000;

function fakeManager() {
  return {
    setOffline: jest.fn(),
    on: jest.fn(() => () => undefined),
    off: jest.fn(),
    mint: { getMintInfo: jest.fn(), getAllMints: jest.fn(async () => []) },
    history: { getPaginatedHistory: jest.fn(async () => []) },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function mount() {
  const view = render(
    <SovranColadaProvider>
      <CameraScreen />
    </SovranColadaProvider>
  );
  await flush();
  return view;
}

function layout() {
  return mockLayout.current as {
    handleScan: (result: { data?: string }) => void;
    handleClipboardPress: () => Promise<void>;
    handleGalleryPress: () => Promise<void>;
    loading: boolean;
    progress: number;
  };
}

async function scan(data: string) {
  await act(async () => layout().handleScan({ data }));
  await flush();
}

function receiveTokenOpens(): number {
  return mockRouter.navigate.mock.calls.filter(
    ([href]) => (href as { pathname?: string }).pathname === '/(receive-flow)/receiveToken'
  ).length;
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.clearAllMocks();
  mockManagerHolder.current = fakeManager();
  mockLayout.current = null;
  mockButtons.current = null;
  mockAppStateListeners.length = 0;
  mockFocus.blur = null;
  mockClipboardText = '';
  mockParams = {};
  now += 10_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void
  ) => {
    mockAppStateListeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a live scan', () => {
  it('opens the receive-token screen for an ecash token and leaves the camera idle', async () => {
    await mount();

    await scan(TOKEN);

    expect(receiveTokenOpens()).toBe(1);
    expect(layout().loading).toBe(false);
  });

  it('shows the unsupported-input popup for an unreadable code and unwinds the busy state', async () => {
    await mount();

    await scan('hello world');

    expect(staticPopup).toHaveBeenCalledWith('unsupported-input', { text: 'Unsupported input' });
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    expect(layout().loading).toBe(false);

    await scan(TOKEN);
    expect(receiveTokenOpens()).toBe(1);
  });

  it.each([PAIRING, 'bunker://abc'])(
    'treats a Remote Login code (%s) as unsupported input, like any other',
    async (code) => {
      // Remote Login is gone (ADR 0035): the code reaches the payment machine,
      // which logs lengths only and turns it down.
      await mount();

      await scan(`  ${code}  `);

      expect(staticPopup).toHaveBeenCalledWith('unsupported-input', { text: 'Unsupported input' });
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    }
  );

  it('drops the same code repeated inside 500 ms', async () => {
    await mount();

    await scan('hello world');
    now += 499;
    await scan('hello world');
    expect(staticPopup).toHaveBeenCalledTimes(1);

    now += 1;
    await scan('hello world');
    expect(staticPopup).toHaveBeenCalledTimes(2);
  });

  it('ignores scans while the app is in the background and after the screen loses focus', async () => {
    await mount();

    act(() => mockAppStateListeners.forEach((listener) => listener('background')));
    await scan(TOKEN);
    expect(receiveTokenOpens()).toBe(0);

    act(() => mockAppStateListeners.forEach((listener) => listener('active')));
    act(() => mockFocus.blur?.());
    await scan(TOKEN);
    expect(receiveTokenOpens()).toBe(0);
  });

  it('offers the gallery', async () => {
    await mount();
    expect(mockButtons.current?.onGallery).toEqual(expect.any(Function));
  });
});

describe('paste and gallery', () => {
  it('pastes a token through the payment scan, reading the clipboard once', async () => {
    mockClipboardText = ` ${TOKEN} `;
    await mount();

    await act(async () => layout().handleClipboardPress());
    await flush();

    expect(receiveTokenOpens()).toBe(1);
    // The payment machine's clipboard source is the only reader.
    expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
  });

  it('turns down a pasted Remote Login link as unsupported input', async () => {
    mockClipboardText = 'nostrconnect://broken';
    await mount();

    await act(async () => layout().handleClipboardPress());
    await flush();

    expect(staticPopup).toHaveBeenCalledWith('unsupported-input', { text: 'Unsupported input' });
    expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
  });

  it('says there is nothing to paste when the clipboard is empty', async () => {
    await mount();

    await act(async () => layout().handleClipboardPress());
    await flush();

    expect(staticPopup).toHaveBeenCalledTimes(1);
    expect(staticPopup).toHaveBeenCalledWith('no-clipboard-address');
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    expect(layout().loading).toBe(false);
  });

  it('does nothing visible when the gallery pick is cancelled', async () => {
    await mount();

    await act(async () => layout().handleGalleryPress());
    await flush();

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    expect(staticPopup).not.toHaveBeenCalled();
    expect(popup).not.toHaveBeenCalled();
    expect(layout().loading).toBe(false);
  });
});
