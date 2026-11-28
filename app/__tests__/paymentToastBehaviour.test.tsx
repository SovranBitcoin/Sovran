/**
 * @jest-environment node
 *
 * The transaction toasts end to end: the payment flow's notifications and the
 * wallet's events go in, and what the toast stack draws (and where a tap
 * leads) comes out. Only the edges are replaced: the Coco manager, the router,
 * and the native leaves of the toast (blur, spinner, pill).
 *
 * Each case is a way the toasts used to go wrong (T1–T11 of the toast audit).
 */

import TestRenderer, { act } from 'react-test-renderer';

import { useManagerContext } from '@cashu/coco-react';

import { createSovranNotifications } from '@/features/send/lib/sovranPaymentConfig';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import { showToast } from '@/shared/lib/popup/popups/bridge';
// The module that puts the payment toasts on the stack; the app's popup index loads it.
import '@/shared/lib/popup/popups/payment';
import { focusTransaction, paymentToasts } from '@/shared/stores/runtime/paymentStatusStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { transactionFocusIds } from '@/features/transactions/lib/useFocusedTransaction';
import { ToastHost } from '@/shared/ui/composed/ToastHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
jest.mock(
  'react-native-gesture-handler',
  () => require('./helpers/sheetRuntimeMocks').gestureHandler
);
jest.mock('react-native-screens', () => require('./helpers/sheetRuntimeMocks').screens);
jest.mock('react-native-worklets', () => require('./helpers/sheetRuntimeMocks').worklets);
jest.mock('react-native-safe-area-context', () => require('./helpers/sheetRuntimeMocks').safeArea);
jest.mock(
  'react-native-keyboard-controller',
  () => require('./helpers/sheetRuntimeMocks').keyboardController
);

jest.mock('@cashu/coco-react', () => ({ useManagerContext: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), dismiss: jest.fn() },
  useSegments: jest.fn(() => []),
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-blur', () => ({ BlurView: () => null }));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  getBitchatNickname: jest.fn(() => 'Self Sender'),
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: jest.fn(() => 'profile-scope'),
}));
jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return {
    paymentLog: logger,
    popupLog: logger,
    storeLog: logger,
    cashuLog: logger,
    log: { ...logger, child: () => logger },
    mintUrlLogFields: jest.fn(() => ({})),
    redactError: (error: unknown) => error,
  };
});
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/third-party/emoji', () => ({ decode: jest.fn(), isEncoded: jest.fn() }));
jest.mock('@/shared/lib/nfc', () => ({
  writeTokenToNFC: jest.fn(),
  NfcError: class NfcError extends Error {},
  isUserCancelError: jest.fn(() => false),
}));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
  linkTransactionAnnotation: jest.fn(),
  setDistributionAnnotation: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({
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
jest.mock('@/shared/lib/popup/popups/factory', () => ({
  makeStaticPopup: () => () => undefined,
  makeParamPopup: () => () => undefined,
}));
jest.mock('@/features/send/lib/paymentOptionPicker', () => ({
  choosePaymentOption: jest.fn(),
  chooseFallbackPaymentOption: jest.fn(),
}));
jest.mock('@/features/send/lib/proofSelectorPicker', () => ({ chooseProofs: jest.fn() }));
jest.mock('@/features/send/lib/sendFallbackPicker', () => ({ chooseSendFallback: jest.fn() }));
jest.mock('@/shared/hooks/useTransactionLocation', () => ({
  captureAndStoreLocation: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => {
  const state = { active: null, radarVisible: false };
  const useNearPaySessionStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return { useNearPaySessionStore };
});
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: jest.fn(() => ({ selectedMint: null, standingQuotes: {} })) },
}));
jest.mock('@/shared/stores/profile/npcMintStore', () => ({
  useNpcMintStore: { getState: jest.fn(() => ({ getActiveMintUrl: jest.fn() })) },
}));
jest.mock('@/shared/lib/cashu/npc', () => ({ getNpcAddress: jest.fn() }));
jest.mock('@/shared/stores/global/settingsStore', () => {
  const state = { displayBtc: 2 };
  const useSettingsStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return { useSettingsStore };
});
jest.mock('@/shared/stores/profile/scanHistoryStore', () => ({
  useScanHistoryStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/sendReachabilityStore', () => ({
  useSendReachabilityStore: {
    getState: jest.fn(() => ({ markChecking: jest.fn(), pruneOld: jest.fn() })),
  },
}));
jest.mock('@/shared/stores/profile/transactionDistributionStore', () => ({
  useTransactionDistributionStore: { getState: jest.fn(() => ({})) },
}));

// The native leaves of the toast; everything above them is real.
jest.mock('@/shared/blocks/status', () => ({ LoadingIndicator: () => null }));
jest.mock('@/shared/ui/capability', () => ({
  useCapabilities: () => ({ frostedSurface: false }),
}));
jest.mock('@/shared/lib/popup/useToastSurface', () => ({
  useToastSurface: () => ({ fg: 'white', bg: 'black' }),
}));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({
  E2EPaymentToastRenderMarker: () => null,
  E2EStaticToastRenderMarker: () => null,
}));
jest.mock('@/shared/lib/popup/CompactToast', () => ({
  CompactToast: ({ label }: { label: string }) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement('Toast', { testID: `toast-${label}` }),
}));
jest.mock('@/shared/ui/primitives/PillButton', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const PillButton = Object.assign(
    (props: Record<string, unknown>) => ReactActual.createElement('PillButton', props),
    { Label: () => null }
  );
  return { PillButton };
});
jest.mock('@/shared/hooks/usePaymentCopyResolver', () => {
  const { createPaymentCopyResolver } = jest.requireActual('wallet');
  const resolver = createPaymentCopyResolver();
  return { usePaymentCopyResolver: () => resolver };
});
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn(), push: jest.fn() },
}));
jest.mock('@/shared/hooks/useSingleFlight', () => ({
  useSingleFlight: (callback: (...args: unknown[]) => unknown) => callback,
}));

const mockHistory: Record<string, unknown>[] = [];
const mockMeltQuoteGet = jest.fn(async (): Promise<{ method: string } | null> => null);
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    isInitialized: () => true,
    getInstance: () => ({
      history: { getPaginatedHistory: jest.fn(async () => mockHistory) },
      quotes: { melt: { get: mockMeltQuoteGet } },
    }),
  },
}));

const MINT = 'https://mint.example';
const BASE = { mintUrl: MINT, amount: 200, unit: 'sat' };
const navigate = jest.mocked(guardedRouter.navigate);

type Handler = (payload: never) => void;
const handlers = new Map<string, Set<Handler>>();
const fakeManager = {
  on: (event: string, handler: Handler) => {
    const set = handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    handlers.set(event, set);
    return () => set.delete(handler);
  },
  quotes: { mint: { get: jest.fn() }, melt: { get: mockMeltQuoteGet } },
  mint: { getAllTrustedMints: jest.fn().mockResolvedValue([]) },
};

function emit(event: string, payload: unknown): void {
  act(() => {
    for (const handler of handlers.get(event) ?? []) handler(payload as never);
  });
}

function Listener(): null {
  usePaymentStatusListener();
  return null;
}

let renderer: TestRenderer.ReactTestRenderer;
let notifications: ReturnType<typeof createSovranNotifications>;

const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

/** A drawn (host) node's test id, on native or web. */
const testIdOf = (node: TestRenderer.ReactTestInstance): string | undefined =>
  typeof node.type === 'string'
    ? ((node.props['data-testid'] ?? node.props.testID) as string | undefined)
    : undefined;

/** The stages of every payment toast on screen, e.g. `melt-processing`. */
function stages(): string[] {
  return renderer.root
    .findAll((node) => {
      const id = testIdOf(node);
      return (
        !!id &&
        id.startsWith('payment-status-') &&
        !['payment-status-toast', 'payment-status-view'].includes(id)
      );
    })
    .map((node) => testIdOf(node)!.replace('payment-status-', ''));
}

/** The title drawn by the payment toast in `stage`. */
function titleOf(stage: string): string {
  const node = renderer.root.find((n) => testIdOf(n) === `payment-status-${stage}`);
  return [node.props.children].flat().join('');
}

async function pressView(): Promise<void> {
  const view = renderer.root.find(
    (n) => (n.type as unknown) === 'PillButton' && n.props.testID === 'payment-status-view'
  );
  await act(async () => {
    await view.props.onPress();
  });
  await settle();
}

const meltFinalized = (quoteId: string, method = 'bolt11') => ({
  mintUrl: MINT,
  operationId: `op-${quoteId}`,
  operation: { id: `op-${quoteId}`, quoteId, method, unit: 'sat', amount: 200 },
});

const meltEntry = (quoteId: string, state: string, extra: Record<string, unknown> = {}) => ({
  type: 'melt',
  id: `op-${quoteId}`,
  operationId: `op-${quoteId}`,
  quoteId,
  mintUrl: MINT,
  amount: 200,
  unit: 'sat',
  state,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...extra,
});

const requestEntry = (operationId: string, state = 'pending') => ({
  type: 'send',
  id: operationId,
  operationId,
  mintUrl: MINT,
  amount: 200,
  unit: 'sat',
  state,
  createdAt: Date.now(),
  metadata: { transportType: 'nostr' },
});

function resetToasts(): void {
  act(() => paymentToasts.dismissAll());
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  handlers.clear();
  mockHistory.length = 0;
  mockMeltQuoteGet.mockResolvedValue(null);
  resetToasts();
  useSwapStatusStore.setState({ active: null });
  jest
    .mocked(useManagerContext)
    .mockReturnValue(Object.assign(Object.create(null), { manager: fakeManager }));
  act(() => {
    renderer = TestRenderer.create(
      <>
        <ToastHost />
        <Listener />
      </>
    );
  });
  notifications = createSovranNotifications();
});

afterEach(() => {
  act(() => paymentToasts.setFocus(null));
  act(() => renderer.unmount());
  // Toasts in flight hold timers: none may outlive its test.
  paymentToasts.dismissAll();
  jest.useRealTimers();
});

const startMelt = (quoteId?: string) =>
  act(
    () =>
      void notifications.onPaymentProcessing!({
        variant: 'melt',
        ...BASE,
        ...(quoteId ? { quoteId } : {}),
      })
  );
const startRequest = () =>
  act(() => void notifications.onPaymentProcessing!({ variant: 'paymentRequest', ...BASE }));
const confirm = (variant: 'melt' | 'paymentRequest', entry: Record<string, unknown>) =>
  act(
    () =>
      void notifications.onPaymentConfirmed!({
        variant,
        ...BASE,
        historyEntry: JSON.stringify(entry),
      })
  );
const paidInvoice = (quoteId: string) =>
  emit('mint-quote:updated', {
    mintUrl: MINT,
    method: 'bolt11',
    quoteId,
    quote: { method: 'bolt11', state: 'PAID', amount: 21, unit: 'sat' },
  });
const mintFinalized = (quoteId: string, method = 'bolt11') =>
  emit('mint-op:finalized', {
    mintUrl: MINT,
    operationId: `mint-op-${quoteId}`,
    operation: { quoteId, method, unit: 'sat', amount: 21 },
  });

describe('overlapping payments (T1)', () => {
  it('gives a send and a receive in flight together a toast each, and leaves neither spinning', () => {
    startMelt('mq1');
    advance(1000);
    expect(stages()).toEqual(['melt-processing']);

    paidInvoice('q1');
    advance(1000);
    expect(stages().sort()).toEqual(['melt-processing', 'receive-processing']);

    mintFinalized('q1');
    advance(1000);
    expect(stages().sort()).toEqual(['melt-processing', 'receive-confirmed']);

    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(1000);
    expect(stages()).toContain('melt-confirmed');
    expect(stages()).not.toContain('melt-processing');

    advance(10_000);
    expect(stages()).toEqual([]);
  });
});

describe('cancel (T2)', () => {
  it('closes the toast of a payment the person backed out of', () => {
    startMelt();
    advance(1000);
    expect(stages()).toEqual(['melt-processing']);
    act(() => void notifications.onPaymentCancelled!({ variant: 'melt', ...BASE }));
    advance(500);
    expect(stages()).toEqual([]);
  });
});

describe('View opens that transaction (T3)', () => {
  it('opens a Lightning send the app started itself, from history, as a history view', async () => {
    mockHistory.push(meltEntry('mq1', 'finalized'));
    startMelt('mq1');
    advance(1000);
    confirm('melt', meltEntry('mq1', 'PAID'));
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(1000);
    await pressView();

    expect(navigate).toHaveBeenCalledTimes(1);
    const { pathname, params } = navigate.mock.calls[0]![0] as {
      pathname: string;
      params: Record<string, string>;
    };
    expect(pathname).toBe('/lightningSend');
    expect(params.historyView).toBe('1');
    // The saved entry, not one made up from the toast.
    expect(JSON.parse(params.meltHistoryEntry!)).toEqual(mockHistory[0]);
  });

  it('opens an on-chain send on the on-chain screen', async () => {
    mockHistory.push(meltEntry('mq2', 'finalized'));
    mockMeltQuoteGet.mockResolvedValue({ method: 'onchain' });
    emit('melt-op:finalized', meltFinalized('mq2', 'onchain'));
    advance(1000);
    await pressView();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).toMatchObject({
      pathname: '/onchainSend',
      params: { historyView: '1' },
    });
  });

  it('opens a payment request the app started itself', async () => {
    mockHistory.push(requestEntry('send-op-1', 'finalized'));
    startRequest();
    advance(1000);
    confirm('paymentRequest', requestEntry('send-op-1'));
    emit('send:finalized', {
      mintUrl: MINT,
      operationId: 'send-op-1',
      operation: { amount: 200, unit: 'sat' },
    });
    advance(1000);
    expect(stages()).toEqual(['payment-request-confirmed']);
    await pressView();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).toMatchObject({
      pathname: '/sendToken',
      params: { historyView: '1' },
    });
    const params = (navigate.mock.calls[0]![0] as { params: Record<string, string> }).params;
    expect(JSON.parse(params.sendHistoryEntry!)).toMatchObject({ operationId: 'send-op-1' });
  });

  it('opens nothing when the transaction is not in history yet', async () => {
    startMelt('mq1');
    advance(1000);
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(1000);
    await pressView();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('timing', () => {
  it('closes a result on time whatever other toasts come and go (T4)', () => {
    mintFinalized('deposit-1', 'onchain');
    advance(100);
    expect(stages()).toEqual(['receive-confirmed']);
    advance(1900);
    act(() => showToast({ variant: 'success', label: 'Copied' }));
    advance(900);
    act(() => showToast({ variant: 'success', label: 'Copied again' }));
    advance(400);
    // 3.3 s after it appeared: gone, though two toasts arrived in between.
    expect(stages()).toEqual([]);
  });

  it('shows no spinner for a payment that settles at once (T10)', () => {
    startMelt('mq1');
    expect(stages()).toEqual([]);
    advance(150);
    expect(stages()).toEqual([]);
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(50);
    expect(stages()).toEqual(['melt-confirmed']);
  });

  it('stops spinning once a payment request is delivered, and closes itself (T5)', () => {
    startRequest();
    advance(1000);
    expect(stages()).toEqual(['payment-request-processing']);
    confirm('paymentRequest', requestEntry('send-op-1'));
    advance(1000);
    expect(stages()).toEqual(['payment-request-delivered']);
    advance(10_000);
    expect(stages()).toEqual([]);
    // The claim, whenever it comes, is still told.
    emit('send:finalized', {
      mintUrl: MINT,
      operationId: 'send-op-1',
      operation: { amount: 200, unit: 'sat' },
    });
    advance(100);
    expect(stages()).toEqual(['payment-request-confirmed']);
  });

  it('does not pin a Lightning payment that is taking long (T6)', () => {
    startMelt('mq1');
    advance(1000);
    confirm('melt', meltEntry('mq1', 'PENDING'));
    advance(60_000);
    expect(stages()).toEqual(['melt-processing']);
    advance(61_000);
    expect(stages()).toEqual(['melt-warning']);
    advance(5000);
    expect(stages()).toEqual([]);
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(100);
    expect(stages()).toEqual(['melt-confirmed']);
  });
});

describe('timing follows the timeline', () => {
  it('turns slow when the timeline does: two minutes after the payment went out, not after the toast appeared', () => {
    startMelt('mq1');
    advance(1000);
    // The mint took the payment 90 s ago and has not settled it.
    confirm('melt', meltEntry('mq1', 'PENDING', { updatedAt: Date.now() - 90_000 }));
    advance(29_000);
    expect(stages()).toEqual(['melt-processing']);
    advance(1500);
    expect(stages()).toEqual(['melt-warning']);
  });
});

describe('wording', () => {
  it('does not say a payment was sent while it is still being sent (T7)', () => {
    startMelt('mq1');
    advance(1000);
    expect(titleOf('melt-processing')).not.toBe('Payment sent');
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(1000);
    expect(titleOf('melt-confirmed')).toBe('Payment sent');
  });

  it('does not show an unknown outcome as a failure, and tells the success that follows (T8)', () => {
    startMelt('mq1');
    advance(1000);
    act(
      () =>
        void notifications.onPaymentFailed!({
          variant: 'melt',
          ...BASE,
          message: 'The payment may still complete. Check your history before you pay again.',
          authored: true,
          outcomeUnknown: true,
        })
    );
    advance(1000);
    expect(stages()).toEqual(['melt-warning']);
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(1000);
    expect(stages()).toEqual(['melt-confirmed']);
  });

  it('lets a success that arrives after a failure correct the toast (T8)', () => {
    startMelt('mq1');
    advance(1000);
    act(
      () =>
        void notifications.onPaymentFailed!({ variant: 'melt', ...BASE, message: 'Route failed' })
    );
    advance(1000);
    expect(stages()).toEqual(['melt-failed']);
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(1000);
    expect(stages()).toEqual(['melt-confirmed']);
  });
});

describe('tapping the toast (T3)', () => {
  /** The toast's own body: the pressable row, not the View pill inside it. */
  const body = () =>
    renderer.root.find(
      (n) =>
        typeof n.type !== 'string' &&
        n.props?.accessibilityRole === 'button' &&
        typeof n.props.onPress === 'function' &&
        n.props.testID === undefined
    );

  it('opens that transaction from a tap anywhere, while it is still being paid', async () => {
    mockHistory.push(meltEntry('mq1', 'pending'));
    startMelt('mq1');
    advance(1000);
    expect(stages()).toEqual(['melt-processing']);
    await act(async () => {
      await body().props.onPress();
    });
    await settle();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0]).toMatchObject({
      pathname: '/lightningSend',
      params: { historyView: '1' },
    });
    // Opened: the toast gets out of the way, and stays out of it when the
    // stack next changes.
    expect(stages()).toEqual([]);
    paidInvoice('q7');
    advance(1000);
    expect(stages()).toEqual(['receive-processing']);
    // Its result is still told.
    emit('melt-op:finalized', meltFinalized('mq1'));
    advance(100);
    expect(stages().sort()).toEqual(['melt-confirmed', 'receive-processing']);
  });

  it('offers nothing to tap before the wallet has issued an id for the payment', () => {
    startRequest();
    advance(1000);
    expect(stages()).toEqual(['payment-request-processing']);
    expect(() => body()).toThrow();
  });
});

describe('the transaction screen in front (T11)', () => {
  it('shows no toast for the invoice whose screen is open, and shows it once the screen is left', () => {
    let blur: () => void = () => undefined;
    act(() => {
      blur = focusTransaction('screen-1', ['q1']);
    });
    paidInvoice('q1');
    advance(1000);
    expect(stages()).toEqual([]);
    mintFinalized('q1');
    advance(1000);
    expect(stages()).toEqual([]);

    // Another payment is still told while that screen is up.
    emit('melt-op:finalized', meltFinalized('mq9'));
    advance(100);
    expect(stages()).toEqual(['melt-confirmed']);

    act(() => blur());
    expect(stages().sort()).toEqual(['melt-confirmed', 'receive-confirmed']);
  });

  it('shows no toast for a payment started from the screen in front, before it has an id', () => {
    let blur: () => void = () => undefined;
    act(() => {
      blur = focusTransaction('screen-1', ['preview-entry']);
    });
    startRequest();
    advance(1000);
    expect(stages()).toEqual([]);
    // The preview becomes the payment's own entry: same screen, new ids, still quiet.
    act(() => {
      blur = focusTransaction('screen-1', ['send-op-1']);
    });
    expect(stages()).toEqual([]);
    act(() => blur());
    expect(stages()).toEqual(['payment-request-processing']);
  });

  it('is not cleared by a screen that is no longer the one in front', () => {
    let blurFirst: () => void = () => undefined;
    act(() => {
      blurFirst = focusTransaction('screen-1', ['q0']);
      focusTransaction('screen-2', ['q1']);
    });
    paidInvoice('q1');
    advance(1000);
    // The first screen's late blur must not un-quiet the second's transaction.
    act(() => blurFirst());
    expect(stages()).toEqual([]);
  });

  it('knows a transaction screen by every id a toast could know its entry by', () => {
    const entry = (fields: Record<string, unknown>) => fields as never;
    expect(
      transactionFocusIds(
        entry({
          id: 'entry-1',
          operationId: 'op-1',
          quoteId: 'q-1',
          metadata: { operationId: 'op-2' },
        })
      )
    ).toEqual(['entry-1', 'op-1', 'q-1', 'op-2']);
    expect(transactionFocusIds(entry({ id: 'same', operationId: 'same' }))).toEqual(['same']);
    expect(transactionFocusIds(undefined)).toEqual([]);
  });
});
