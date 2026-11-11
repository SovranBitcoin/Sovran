/**
 * @jest-environment node
 *
 * Characterization of reopening a payment route for an operation already in
 * flight (from the transactions list, a status toast or a link): the route
 * shell parses its param, and the screen binds the wallet's screen actions to
 * the entry it was given. Pinned at what the person sees offered and at what
 * reaches the wallet core: reopening must not start the payment again.
 *
 * Receive and Lightning send run their real route shell, real screen and real
 * screen actions inside the real SovranColadaProvider, against a manager that
 * records every call. The screens' presentational leaves are replaced. The
 * ecash send route is pinned at its shell only (see the note on that block).
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
  canGoBack: jest.fn(() => true),
  raw: { back: jest.fn() },
};
const mockManagerHolder: { current: unknown } = { current: null };
const mockCalls: string[] = [];
let mockParams: Record<string, string> = {};
const mockSendScreenProps: { current: Record<string, unknown> | null } = { current: null };

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
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  router: {},
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  get guardedRouter() {
    return mockRouter;
  },
}));
jest.mock('expo-linking', () => ({ useURL: () => null }));
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
  getStringAsync: jest.fn(async () => ''),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: 'ab'.repeat(32) } }),
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/features/camera/hooks/useHandleCameraPermission', () => ({
  useHandleCameraPermission: () => ({ handlePermission: async () => true }),
}));
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
  paymentStatusPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
// Presentational leaves of the two screens.
jest.mock('@/features/transactions', () => ({
  entryDetailItems: () => [],
  TransactionDetailShell: ({
    children,
    footer,
  }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
  TransactionLocationSection: () => null,
  HistoryEntryRefresh: () => null,
  useBip321Info: () => ({ isBip321: false, optionKinds: null }),
  amountDetailItem: () => null,
  stateDetailItem: () => null,
  quoteIdDetailItem: () => null,
  mintDetailItem: () => null,
  transactionLeadDetailItems: () => [],
  useIsTransactionHistoryView: () => true,
}));
jest.mock('@/features/wallet', () => ({ MintSelector: () => null }));
jest.mock('@/features/send/components/RecipientHeader', () => ({ RecipientHeader: () => null }));
jest.mock('@/features/send/components/MeltDestinationFingerprintProbe', () => ({
  MeltDestinationFingerprintProbe: () => null,
}));
jest.mock('@/features/send/components/MeltSelectedMintProbe', () => ({
  MeltSelectedMintProbe: () => null,
}));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: () => null }));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: () => ({ metadata: null }),
  parseRawMetadata: () => null,
}));
jest.mock('@/shared/ui/composed/MiddleEllipsisValue', () => ({ MiddleEllipsisValue: () => null }));
jest.mock('@/shared/ui/composed/DetailsSection', () => ({ DetailsSection: () => null }));
jest.mock('@/shared/ui/composed/CopyableValue', () => ({ CopyableValue: () => null }));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: () => 'error state',
  ScreenLoadingState: () => 'loading state',
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ButtonHandler: ({
      buttons,
    }: {
      buttons: { testID: string; text: string; condition?: boolean; onPress: () => void }[];
    }) =>
      ReactActual.createElement(
        ReactActual.Fragment,
        null,
        ...buttons
          .filter((button) => button.condition !== false)
          .map((button) =>
            ReactActual.createElement('MockButton', {
              key: button.testID,
              testID: button.testID,
              onPress: button.onPress,
            })
          )
      ),
  };
});
jest.mock('@/features/send/screens/SendTokenScreen', () => ({
  SendTokenScreen: (props: Record<string, unknown>) => {
    mockSendScreenProps.current = props;
    return null;
  },
}));

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { SovranColadaProvider } from '@/features/send/providers/Colada';
import { ReceiveTokenRoute } from '@/features/receive/screens/ReceiveTokenRoute';
import { LightningSendRoute } from '@/features/send/screens/LightningSendRoute';
import { SendTokenRoute } from '@/features/send/screens/SendTokenRoute';

const MINT = 'https://mint1.example.com';
const TOKEN =
  'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludDEuZXhhbXBsZS5jb20iLCJwcm9vZnMiOlt7ImFtb3VudCI6MSwic2VjcmV0IjoiYWJjIiwiQyI6IjAyYWJjIiwiaWQiOiIwMGFkMjY4YyJ9XX1dLCJ1bml0Ijoic2F0In0=';

/** A manager whose every method records its path and resolves to nothing. */
function recordingManager(): unknown {
  const make = (path: string): unknown =>
    new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        if (typeof prop === 'symbol') return undefined;
        return make(path ? `${path}.${prop}` : prop);
      },
      apply() {
        mockCalls.push(path);
        if (path === 'on' || path.endsWith('.on') || path.endsWith('subscribe')) return () => {};
        if (path.endsWith('getPaginatedHistory')) return Promise.resolve([]);
        // Trusted, so a redeem that did start would go on to the receive itself.
        if (path.endsWith('isTrustedMint')) return Promise.resolve(true);
        return Promise.resolve(undefined);
      },
    });
  return make('');
}

/** Calls that would start, pay, redeem or roll back money. */
function moneyCalls(): string[] {
  return mockCalls.filter((path) =>
    /(prepare|execute|receive|redeem|send\b|pay|melt\.|mint\.create|reclaim|cancel|finalize)/i.test(
      path.replace(/^ops\.\w+\.get$/, '')
    )
  );
}

function testIds(): string[] {
  const ids: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: { testID?: string }; children?: unknown[] };
    if (n.props?.testID) ids.push(n.props.testID);
    n.children?.forEach(walk);
  };
  walk(screen.toJSON());
  return ids;
}

async function open(route: React.ReactElement, params: Record<string, string>) {
  mockParams = params;
  render(<SovranColadaProvider>{route}</SovranColadaProvider>);
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockManagerHolder.current = recordingManager();
  mockSendScreenProps.current = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// `receive-…` is the id the app gives a scanned token before it is redeemed; a receive
// reopened from history carries Coco's own id.
const PLACEHOLDER_ID = 'receive-local-1';
const CANONICAL_ID = 'op-7f3a';
const RECEIVE_BASE = {
  id: CANONICAL_ID,
  type: 'receive',
  amount: 1,
  unit: 'sat',
  mintUrl: MINT,
  createdAt: 1_752_000_000_000,
  metadata: { rawToken: TOKEN },
};

describe('reopening a receive', () => {
  it('offers Redeem for a token not yet redeemed, and redeems nothing on open', async () => {
    await open(<ReceiveTokenRoute where="test.receiveToken" />, {
      receiveHistoryEntry: JSON.stringify({
        ...RECEIVE_BASE,
        id: PLACEHOLDER_ID,
        state: 'prepared',
      }),
    });

    expect(testIds()).toEqual(expect.arrayContaining(['receive-token-redeem']));
    expect(moneyCalls()).toEqual([]);
  });

  it('decides redeemed from the id, not the state', async () => {
    await open(<ReceiveTokenRoute where="test.receiveToken" />, {
      receiveHistoryEntry: JSON.stringify({
        ...RECEIVE_BASE,
        id: PLACEHOLDER_ID,
        state: 'finalized',
      }),
    });

    // QUIRK: a `receive-…` id is read as "not redeemed yet" whatever its state says, so a
    // finalized entry carrying that id still offers Redeem.
    expect(testIds()).toContain('receive-token-redeem');
    expect(moneyCalls()).toEqual([]);
  });

  it.each(['finalized', 'executing'])(
    'offers no Redeem for a receive already %s, and starts nothing',
    async (state) => {
      await open(<ReceiveTokenRoute where="test.receiveToken" />, {
        receiveHistoryEntry: JSON.stringify({ ...RECEIVE_BASE, state }),
      });

      expect(testIds()).not.toContain('receive-token-redeem');
      expect(moneyCalls()).toEqual([]);
    }
  );

  it.each([
    ['missing', {}],
    ['empty', { receiveHistoryEntry: '' }],
  ])('renders nothing for a %s entry param', async (_label, params) => {
    await open(<ReceiveTokenRoute where="test.receiveToken" />, params);

    expect(screen.toJSON()).toBeNull();
    expect(moneyCalls()).toEqual([]);
  });

  it('shows the error state for an entry param that is not JSON', async () => {
    await open(<ReceiveTokenRoute where="test.receiveToken" />, {
      receiveHistoryEntry: 'not json',
    });

    // QUIRK: the route schema accepts any non-empty string; the screen's decoder is what
    // turns it down.
    expect(JSON.stringify(screen.toJSON())).toMatch(/error state|loading state/);
    expect(testIds()).not.toContain('receive-token-redeem');
    expect(moneyCalls()).toEqual([]);
  });
});

const MELT_BASE = {
  id: 'melt-1',
  type: 'melt',
  quoteId: 'quote-1',
  amount: 40,
  unit: 'sat',
  mintUrl: MINT,
  createdAt: 1_752_000_000_000,
  metadata: {},
};

describe('reopening a Lightning send', () => {
  it('offers no Pay for a melt already pending, and pays nothing on open', async () => {
    await open(<LightningSendRoute where="test.lightningSend" />, {
      meltHistoryEntry: JSON.stringify({ ...MELT_BASE, state: 'PENDING' }),
    });

    expect(testIds()).not.toContain('melt-pay');
    // QUIRK: a Lightning payment already in flight is offered Cancel.
    expect(testIds()).toContain('melt-cancel');
    expect(moneyCalls()).toEqual([]);
  });

  it('offers Close for a melt already paid', async () => {
    await open(<LightningSendRoute where="test.lightningSend" />, {
      meltHistoryEntry: JSON.stringify({ ...MELT_BASE, state: 'PAID' }),
    });

    expect(testIds()).toContain('melt-close');
    expect(testIds()).not.toContain('melt-pay');
    expect(moneyCalls()).toEqual([]);
  });

  it('offers Pay for a real unpaid quote but does not pay until pressed', async () => {
    await open(<LightningSendRoute where="test.lightningSend" />, {
      meltHistoryEntry: JSON.stringify({ ...MELT_BASE, state: 'UNPAID' }),
    });

    expect(testIds()).toEqual(expect.arrayContaining(['melt-pay', 'melt-cancel']));
    expect(moneyCalls()).toEqual([]);
  });
});

describe('reopening an ecash send (route shell only)', () => {
  // The send screen's real body pulls in the payment-info, alert and lock surfaces;
  // only the route boundary is pinned here: what the screen is handed on reopening.
  it('hands the screen the same entry and keeps both offline flags', async () => {
    const entry = JSON.stringify({ id: 'send-1', type: 'send', state: 'pending' });
    await open(<SendTokenRoute where="test.sendToken" />, {
      sendHistoryEntry: entry,
      createdOffline: 'true',
      mintWasOffline: 'true',
    });

    expect(mockSendScreenProps.current).toMatchObject({
      sendHistoryEntry: entry,
      createdOffline: true,
      mintWasOffline: true,
    });
    expect(moneyCalls()).toEqual([]);
  });

  it.each(['1', 'TRUE', 'yes'])('treats offline flag %s as not offline', async (flag) => {
    await open(<SendTokenRoute where="test.sendToken" />, {
      sendHistoryEntry: '{}',
      createdOffline: flag,
      mintWasOffline: flag,
    });

    expect(mockSendScreenProps.current).toMatchObject({
      createdOffline: false,
      mintWasOffline: false,
    });
  });

  it('closes back through the router', async () => {
    await open(<SendTokenRoute where="test.sendToken" />, { sendHistoryEntry: '{}' });

    (mockSendScreenProps.current!.onNavigateBack as () => void)();

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a flag longer than the route allows', async () => {
    await open(<SendTokenRoute where="test.sendToken" />, {
      sendHistoryEntry: '{}',
      createdOffline: 'x'.repeat(17),
    });

    expect(mockSendScreenProps.current).toBeNull();
  });
});
