/**
 * @jest-environment node
 *
 * Characterization of a payment link opening the app: the URL Expo hands the
 * app (`Linking.useURL`) through the real SovranColadaProvider, the real wallet
 * ColadaProvider and payment machine, and the real Sovran step handlers, to the
 * navigation they issue. Also what the native-intent rewrite does to the same
 * links before Expo Router sees them. The router, the manager and the keys are
 * replaced.
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
let mockUrl: string | null = null;
let mockKeys: { pubkey: string } | null = { pubkey: 'ab'.repeat(32) };
const mockManagerHolder: { current: unknown } = { current: null };

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
jest.mock('expo-router', () => ({
  useNavigationContainerRef: () => ({ isReady: () => false, getRootState: () => undefined }),
  useSegments: () => [],
  router: {},
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  get guardedRouter() {
    return mockRouter;
  },
}));
jest.mock('expo-linking', () => ({ useURL: () => mockUrl }));
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
  getStringAsync: jest.fn(async () => ''),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/features/camera/hooks/useHandleCameraPermission', () => ({
  useHandleCameraPermission: () => ({ handlePermission: async () => true }),
}));
jest.mock('@/shared/lib/nfc', () => ({
  createNfcAdapter: () => ({}),
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
  copyPopup: jest.fn(),
  copyTokenAsEmoji: jest.fn(),
  nfcConnectionLostPopup: jest.fn(),
  nfcEcashSharedPopup: jest.fn(),
  nfcSendFailedPopup: jest.fn(),
  paymentCancelledPopup: jest.fn(),
  paymentStatusPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));

import { act, render } from '@testing-library/react-native';

import { SovranColadaProvider } from '@/features/send/providers/Colada';
import { rewriteSystemPath } from '@/app/+native-intent';
import { staticPopup } from '@/shared/lib/popup';

const MINT = 'https://mint1.example.com';
// A real V3 token for MINT (same vector as walletProviderLifecycle.test.tsx).
const TOKEN =
  'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludDEuZXhhbXBsZS5jb20iLCJwcm9vZnMiOlt7ImFtb3VudCI6MSwic2VjcmV0IjoiYWJjIiwiQyI6IjAyYWJjIiwiaWQiOiIwMGFkMjY4YyJ9XX1dLCJ1bml0Ijoic2F0In0=';

function fakeManager() {
  return {
    setOffline: jest.fn(),
    on: jest.fn(() => () => undefined),
    off: jest.fn(),
    mint: { getMintInfo: jest.fn(), getAllMints: jest.fn(async () => []) },
    wallet: { getBalances: jest.fn(async () => ({})) },
    history: { getPaginatedHistory: jest.fn(async () => []) },
  };
}

async function open(url: string | null) {
  mockUrl = url;
  render(
    <SovranColadaProvider>
      <></>
    </SovranColadaProvider>
  );
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

function navigations(): unknown[][] {
  return (['navigate', 'push', 'replace'] as const).flatMap((m) =>
    mockRouter[m].mock.calls.map((args) => [m, ...args])
  );
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.clearAllMocks();
  mockManagerHolder.current = fakeManager();
  mockKeys = { pubkey: 'ab'.repeat(32) };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('payment links opened with the app', () => {
  it.each([`cashu:${TOKEN}`, `cashu://${TOKEN}`, `sovran://${TOKEN}`, `SOVRAN://${TOKEN}`])(
    'opens the receive-token screen for %s with the token decoded into a history entry',
    async (url) => {
      await open(url);

      expect(navigations()).toHaveLength(1);
      const [method, href] = navigations()[0] as [
        string,
        { pathname: string; params: { receiveHistoryEntry: string } },
      ];
      expect(method).toBe('navigate');
      expect(href.pathname).toBe('/(receive-flow)/receiveToken');
      // QUIRK: the bearer token itself travels in the route params (navigation state).
      expect(JSON.parse(href.params.receiveHistoryEntry)).toMatchObject({
        type: 'receive',
        state: 'prepared',
        amount: 1,
        unit: 'sat',
        mintUrl: MINT,
        metadata: { rawToken: TOKEN },
      });
      expect(staticPopup).not.toHaveBeenCalled();
    }
  );

  it('opens nothing until the account has keys', async () => {
    mockKeys = null;

    await open(`cashu:${TOKEN}`);

    expect(navigations()).toEqual([]);
  });

  it('leaves router-owned hosts and other apps alone', async () => {
    await open('sovran://camera');
    await open('sovran://expo-development-client/?url=x');
    await open('https://sovran.money/receive');

    expect(navigations()).toEqual([]);
    expect(staticPopup).not.toHaveBeenCalled();
  });

  it.each(['lightning:lnbc10n1pexample', 'bitcoin:bc1qexample', 'lnurlp:example.com'])(
    'ignores %s although the app registers the scheme',
    async (url) => {
      await open(url);

      // QUIRK: app.json claims lightning:, bitcoin: and lnurl* links, but the payment
      // provider accepts only cashu: and sovran:, so such a link opens the app and nothing else.
      expect(navigations()).toEqual([]);
      expect(staticPopup).not.toHaveBeenCalled();
    }
  );

  it('reports a sovran link that carries no payment as unsupported input', async () => {
    await open('sovran://not-a-payment');

    expect(navigations()).toEqual([]);
    expect(staticPopup).toHaveBeenCalledTimes(1);
    expect(staticPopup).toHaveBeenCalledWith('unsupported-input', { text: 'Unsupported input' });
  });
});

describe('the native-intent rewrite before the router', () => {
  it.each([`cashu:${TOKEN}`, `sovran://${TOKEN}`, 'lightning:lnbc10n1pexample', 'sovran://camera'])(
    'passes %s through unchanged',
    (url) => {
      expect(rewriteSystemPath(url)).toBe(url);
    }
  );

  it('sends a nostrconnect link to the signer connect route with a ticket, not the link', () => {
    const rewritten = rewriteSystemPath('nostrconnect://abc?secret=s3cr3t&relay=wss://r');

    expect(rewritten).toMatch(/^\/\(signer-flow\)\/connect\?ticket=/);
    expect(rewritten).not.toContain('s3cr3t');
  });
});
