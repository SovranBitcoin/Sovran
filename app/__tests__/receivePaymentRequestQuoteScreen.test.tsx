/**
 * @jest-environment node
 *
 * Characterization of the fixed-amount "as Ecash" receive screen
 * (`ReceivePaymentRequestQuoteScreen`): which wallet events move its status,
 * what request it shows, and where a per-request customization is saved. The
 * real screen, mint store and transaction annotation store run; the Coco event
 * source, route params, trusted mints, P2PK key lookup, router and the
 * presentational children (timeline, header, QR block, customization card,
 * error state) are replaced by recorders so their inputs can be read.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { decodePaymentRequest, PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';

import { ReceivePaymentRequestQuoteScreen } from '@/features/receive/screens/ReceivePaymentRequestQuoteScreen';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useTransactionAnnotationStore } from '@/shared/stores/profile/transactionAnnotationStore';

type Listener = (payload: { operation: unknown }) => void;
const mockListeners = new Map<string, Set<Listener>>();
const mockManager = {
  on: jest.fn((event: string, listener: Listener) => {
    const set = mockListeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    mockListeners.set(event, set);
    return () => set.delete(listener);
  }),
  // A finished receive the wallet already holds; the screen never asks for it.
  ops: { receive: { listInFlight: jest.fn(async () => []), get: jest.fn() } },
};
let mockParams: { paymentRequestEntry: string } | null = null;
const mockProps: Record<string, unknown[]> = {};

function mockRecorder(name: string) {
  return (props: Record<string, unknown>) => {
    (mockProps[name] ??= []).push(props);
    return null;
  };
}

jest.mock('wallet/react', () => {
  const { decodeAnnotation } = jest.requireActual('wallet');
  const { useTransactionAnnotationStore: store } = jest.requireActual(
    '@/shared/stores/profile/transactionAnnotationStore'
  );
  return {
    useColadaManager: () => mockManager,
    useColadaTransactionAnnotation: (entry: { operationId?: string } | null) => {
      const record = store((s: { annotations: Record<string, unknown> }) =>
        entry ? s.annotations[`op:${entry.operationId}`] : undefined
      );
      return record ? decodeAnnotation(record) : {};
    },
  };
});
jest.mock('@cashu/coco-react', () => ({
  // Only mint A can lock ecash to a key (NUT-11).
  useMints: () => ({
    trustedMints: [
      { mintUrl: MINT_A, mintInfo: { nuts: { 11: { supported: true } } } },
      { mintUrl: MINT_B, mintInfo: { nuts: {} } },
    ],
  }),
}));
jest.mock('@sovranbitcoin/coco-cashu-plugin-p2pk-import', () => ({
  resolvePrimaryReceiveP2PKPublicKey: async () => mockLockKey,
}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({
  useRouteParams: () => mockParams,
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'gray' }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: mockRecorder('ScreenErrorState'),
}));
jest.mock('@/features/transactions', () => ({
  HistoryEntryHeader: mockRecorder('HistoryEntryHeader'),
  HistoryEntryTimeline: mockRecorder('HistoryEntryTimeline'),
}));
jest.mock('@/shared/blocks/PaymentInfo', () => ({ PaymentInfo: mockRecorder('PaymentInfo') }));
jest.mock('@/features/receive/components/CreqCustomizationCard', () => ({
  CreqCustomizationCard: mockRecorder('CreqCustomizationCard'),
}));

const MINT_A = 'https://mint-a.example';
const MINT_B = 'https://mint-b.example';
const OP_ID = 'request-op-1';
let mockLockKey: string | null = `02${'ab'.repeat(32)}`;

const ENCODED = new PaymentRequest(
  [
    {
      type: PaymentRequestTransportType.NOSTR,
      target: 'nprofile1qqswuyd9ml6qcxd92h6pleptfrcqucvvjy39vg4wx7mv9wm8kakyujgua442w',
      tags: [['n', '17']],
    },
  ],
  'req-1',
  2_100,
  'sat',
  [MINT_A, MINT_B],
  undefined,
  true
).toEncodedRequest();

const ENTRY = {
  operationId: OP_ID,
  encodedRequest: ENCODED,
  amount: 2_100,
  unit: 'sat',
  mints: [MINT_A, MINT_B],
};

const last = <T,>(name: string) => mockProps[name]?.at(-1) as T | undefined;
const timeline = () =>
  last<{ historyEntry: { state: string; error?: string; metadata: Record<string, string> } }>(
    'HistoryEntryTimeline'
  )!.historyEntry;
const cardShown = () => mockProps.CreqCustomizationCard?.length ?? 0;

function emit(event: string, operation: unknown) {
  act(() => {
    mockListeners.get(event)?.forEach((listener) => listener({ operation }));
  });
}

const fromRequest = (requestOperationId: string, extra: Record<string, unknown> = {}) => ({
  id: 'receive-op-x',
  source: { type: 'payment-request', requestOperationId },
  ...extra,
});

let renderer: TestRenderer.ReactTestRenderer | null = null;

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<ReceivePaymentRequestQuoteScreen />);
  });
}

beforeEach(() => {
  mockListeners.clear();
  for (const key of Object.keys(mockProps)) delete mockProps[key];
  mockParams = { paymentRequestEntry: JSON.stringify(ENTRY) };
  mockLockKey = `02${'ab'.repeat(32)}`;
  useMintStore.setState({ creqP2pkLock: false, creqExcludedMints: {} });
  useTransactionAnnotationStore.setState({ annotations: {} });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

test('opens waiting for payment, with the customization card shown', async () => {
  await mount();

  expect(timeline().state).toBe('executing');
  expect(timeline().metadata).toMatchObject({ operationId: OP_ID, paymentRequestPending: '1' });
  expect(cardShown()).toBeGreaterThan(0);
});

test('stays waiting when the wallet already finished this receive before the screen subscribed', async () => {
  // The receive completed during navigation; no event arrives after mount.
  mockManager.ops.receive.get.mockResolvedValue(fromRequest(OP_ID, { state: 'finalized' }));
  await mount();
  await act(async () => {});

  // QUIRK (D1): the screen never reads the wallet's current state, so a
  // receive that finished before it subscribed shows "waiting" for good. A fix
  // should replace this assertion with one that shows the receive settled.
  expect(timeline().state).toBe('executing');
  expect(timeline().metadata.paymentRequestPending).toBe('1');
});

test('a payment seen for this request moves it to paid and hides the customization', async () => {
  await mount();
  const cardRenders = mockProps.CreqCustomizationCard!.length;
  emit('receive-op:prepared', fromRequest(OP_ID));

  expect(timeline().state).toBe('prepared');
  expect(timeline().metadata).not.toHaveProperty('paymentRequestPending');
  expect(mockProps.CreqCustomizationCard!.length).toBe(cardRenders);
});

test('events for another request or another kind of receive change nothing', async () => {
  await mount();
  emit('receive-op:finalized', fromRequest('another-request'));
  emit('receive-op:finalized', { id: 'x', source: { type: 'token', requestOperationId: OP_ID } });
  emit('receive-op:prepared', { id: 'y' });

  expect(timeline().state).toBe('executing');
});

test('finalized is final: a late payment-seen or rejection does not move it back', async () => {
  await mount();
  emit('receive-op:finalized', fromRequest(OP_ID));
  expect(timeline().state).toBe('finalized');

  emit('receive-op:prepared', fromRequest(OP_ID));
  emit('receive-op:rolled-back', fromRequest(OP_ID, { error: 'Token already spent' }));
  expect(timeline().state).toBe('finalized');
  expect(timeline()).not.toHaveProperty('error');
});

test('a rejected payment shows the mint’s reason', async () => {
  await mount();
  emit('receive-op:prepared', fromRequest(OP_ID));
  emit('receive-op:rolled-back', fromRequest(OP_ID, { error: 'Token already spent' }));

  expect(timeline().state).toBe('rolled_back');
  expect(timeline().error).toBe('Token already spent');
});

test('shows the request with its amount, single-use, without a lock by default', async () => {
  await mount();
  const shown = decodePaymentRequest(last<{ data: string }>('PaymentInfo')!.data);

  expect(String(shown.amount)).toBe('2100');
  expect(shown.singleUse).toBe(true);
  expect(shown.nut10).toBeUndefined();
  expect(shown.mints).toEqual([MINT_A, MINT_B]);
});

test('turning the lock on saves it for this request only and re-encodes the request for lock-capable mints', async () => {
  await mount();
  const card = last<{ onP2pkLockChange: (on: boolean) => void }>('CreqCustomizationCard')!;
  await act(async () => card.onP2pkLockChange(true));

  expect(useMintStore.getState().creqP2pkLock).toBe(false);
  expect(useTransactionAnnotationStore.getState().annotations[`op:${OP_ID}`]).toBeDefined();
  const shown = decodePaymentRequest(last<{ data: string }>('PaymentInfo')!.data);
  expect(shown.nut10).toMatchObject({ kind: 'P2PK', data: mockLockKey });
  expect(shown.mints).toEqual([MINT_A]);
  expect(String(shown.amount)).toBe('2100');
});

test('excluding a mint saves it for this request only and narrows the shown mints', async () => {
  await mount();
  const card = last<{ onMintToggle: (url: string, advertise: boolean) => void }>(
    'CreqCustomizationCard'
  )!;
  await act(async () => card.onMintToggle(MINT_B, false));

  expect(useMintStore.getState().creqExcludedMints).toEqual({});
  expect(decodePaymentRequest(last<{ data: string }>('PaymentInfo')!.data).mints).toEqual([MINT_A]);
});

test('a route parameter that is not a valid request shows the error state', async () => {
  mockParams = { paymentRequestEntry: JSON.stringify({ ...ENTRY, amount: 0 }) };
  await mount();

  expect(last<{ message: string }>('ScreenErrorState')!.message).toBe('Invalid payment request');
  expect(mockProps.HistoryEntryTimeline).toBeUndefined();
});

test('leaving the screen stops listening to wallet events', async () => {
  await mount();
  expect(mockListeners.get('receive-op:finalized')?.size).toBe(1);
  act(() => renderer?.unmount());
  renderer = null;

  for (const event of ['receive-op:prepared', 'receive-op:rolled-back', 'receive-op:finalized']) {
    expect(mockListeners.get(event)?.size).toBe(0);
  }
});
