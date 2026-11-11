/**
 * @jest-environment node
 *
 * Characterization of `usePaymentStatusListener`: what each Coco wallet event
 * does to the payment status toast, the saved transaction annotations and the
 * standing quotes. The hook runs against the real payment status, swap status,
 * mint and annotation stores; only the Coco manager, the toast popup and the
 * two wallet rotation calls are replaced.
 */

import { act, renderHook } from '@testing-library/react-native';

import { Amount } from '@cashu/coco-core';
import { useManagerContext } from '@cashu/coco-react';
import { decodeAnnotation, rotateReusableMintQuote, rotateStandingPaymentRequest } from 'wallet';

import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import { paymentStatusPopup } from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useTransactionAnnotationStore } from '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('@cashu/coco-react', () => ({
  useManagerContext: jest.fn(),
}));

jest.mock('@/shared/lib/popup', () => ({
  paymentStatusPopup: jest.fn(),
}));

jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  rotateReusableMintQuote: jest.fn(() => Promise.resolve()),
  rotateStandingPaymentRequest: jest.fn(() => Promise.resolve()),
}));

const mockedUseManagerContext = jest.mocked(useManagerContext);
const mockedPopup = jest.mocked(paymentStatusPopup);
const mockedRotateQuote = jest.mocked(rotateReusableMintQuote);
const mockedRotateCreq = jest.mocked(rotateStandingPaymentRequest);

const MINT = 'https://mint.example';

type Handler = (payload: never) => void;

function createFakeManager() {
  const handlers = new Map<string, Set<Handler>>();
  const mintQuoteGet = jest.fn();
  const meltQuoteGet = jest.fn().mockResolvedValue(null);
  const manager = {
    on: jest.fn((event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      return () => set.delete(handler);
    }),
    quotes: { mint: { get: mintQuoteGet }, melt: { get: meltQuoteGet } },
    mint: { getAllTrustedMints: jest.fn().mockResolvedValue([{ mintUrl: MINT }]) },
  };
  const emit = (event: string, payload: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler(payload as never);
  };
  const listenerCount = () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0);
  return { manager, emit, listenerCount, mintQuoteGet, meltQuoteGet };
}

let fake: ReturnType<typeof createFakeManager>;

function mount() {
  mockedUseManagerContext.mockReturnValue(
    Object.assign(Object.create(null), { manager: fake.manager })
  );
  return renderHook(() => usePaymentStatusListener());
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function active() {
  return usePaymentStatusStore.getState().active;
}

function annotation(key: string) {
  const record = useTransactionAnnotationStore.getState().annotations[key];
  return record ? decodeAnnotation(record) : undefined;
}

function startSwap() {
  useSwapStatusStore
    .getState()
    .start({ id: 'swap-1', legs: [{ id: 'leg' }], meta: { unit: 'sat' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  usePaymentStatusStore.setState(usePaymentStatusStore.getInitialState());
  useSwapStatusStore.setState({ active: null });
  useMintStore.setState({ standingQuotes: {} });
  useTransactionAnnotationStore.setState({ annotations: {} });
  fake = createFakeManager();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('usePaymentStatusListener', () => {
  it('raises one processing receive toast for a paid bolt11 quote and ignores other methods', () => {
    const { unmount } = mount();
    const paid = { method: 'bolt11', state: 'PAID', amount: 21, unit: 'sat' };

    act(() =>
      fake.emit('mint-quote:updated', {
        mintUrl: MINT,
        method: 'bolt11',
        quoteId: 'q1',
        quote: paid,
      })
    );
    act(() =>
      fake.emit('mint-quote:updated', {
        mintUrl: MINT,
        method: 'bolt11',
        quoteId: 'q1',
        quote: paid,
      })
    );
    act(() =>
      fake.emit('mint-quote:updated', {
        mintUrl: MINT,
        method: 'bolt12',
        quoteId: 'q2',
        quote: { ...paid, method: 'bolt12' },
      })
    );
    act(() =>
      fake.emit('mint-quote:updated', {
        mintUrl: MINT,
        method: 'bolt11',
        quoteId: 'q3',
        quote: { ...paid, state: 'UNPAID' },
      })
    );

    expect(mockedPopup).toHaveBeenCalledTimes(1);
    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'receive',
      id: 'q1',
      mintUrl: MINT,
      amount: 21,
      unit: 'sat',
    });
    expect(active()).toMatchObject({ variant: 'receive', id: 'q1', state: 'processing' });
    unmount();
  });

  it('shows a pending bolt11 mint only when its quote row is paid and was updated within five minutes', async () => {
    const { unmount } = mount();
    const paidQuote = (updatedAt: number) => ({
      method: 'bolt11',
      amountPaid: Amount.from(50),
      amountIssued: Amount.from(0),
      updatedAt,
    });
    const pending = (operationId: string, quoteId: string, method = 'bolt11') => ({
      mintUrl: MINT,
      operationId,
      operation: { state: 'pending', method, quoteId, unit: 'sat', amount: 50 },
    });

    fake.mintQuoteGet.mockResolvedValueOnce(paidQuote(Date.now() - 6 * 60 * 1000));
    fake.emit('mint-op:pending', pending('op-old', 'q-old'));
    await flush();
    expect(mockedPopup).not.toHaveBeenCalled();

    fake.emit('mint-op:pending', pending('op-12', 'q-12', 'bolt12'));
    await flush();
    expect(fake.mintQuoteGet).toHaveBeenCalledTimes(1);

    fake.mintQuoteGet.mockResolvedValueOnce(paidQuote(Date.now() - 60 * 1000));
    fake.emit('mint-op:pending', pending('op-new', 'q-new'));
    await flush();
    expect(fake.mintQuoteGet).toHaveBeenLastCalledWith({ mintUrl: MINT, quoteId: 'q-new' });
    expect(mockedPopup).toHaveBeenCalledTimes(1);
    expect(active()).toMatchObject({
      variant: 'receive',
      id: 'q-new',
      state: 'processing',
      amount: 50,
    });
    unmount();
  });

  it('confirms a matching receive toast when its mint finalizes, without a second popup', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'receive',
      id: 'q1',
      mintUrl: MINT,
      amount: 21,
      unit: 'sat',
      state: 'processing',
    });

    act(() =>
      fake.emit('mint-op:finalized', {
        mintUrl: MINT,
        operationId: 'op1',
        operation: { quoteId: 'q1', method: 'bolt11', unit: 'sat', amount: 21 },
      })
    );

    expect(active()).toMatchObject({ id: 'q1', state: 'confirmed' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('raises a confirmed receive for a reusable deposit and rotates only the standing onchain quote', () => {
    const { unmount } = mount();
    useMintStore.getState().setStandingQuote(`${MINT}|onchain|sat`, 'q-standing');

    act(() =>
      fake.emit('mint-op:finalized', {
        mintUrl: MINT,
        operationId: 'op-a',
        operation: { quoteId: 'q-other', method: 'onchain', unit: 'sat', amount: 1000 },
      })
    );
    expect(mockedRotateQuote).not.toHaveBeenCalled();
    expect(mockedPopup).toHaveBeenLastCalledWith({
      variant: 'receive',
      id: 'q-other',
      mintUrl: MINT,
      amount: 1000,
      unit: 'sat',
    });
    expect(active()).toMatchObject({ id: 'q-other', state: 'confirmed' });

    act(() =>
      fake.emit('mint-op:finalized', {
        mintUrl: MINT,
        operationId: 'op-b',
        operation: { quoteId: 'q-standing', method: 'onchain', unit: 'sat', amount: 2000 },
      })
    );
    expect(mockedRotateQuote).toHaveBeenCalledTimes(1);
    expect(mockedRotateQuote).toHaveBeenCalledWith(
      fake.manager,
      { mintUrl: MINT, method: 'onchain', unit: 'sat' },
      expect.any(Object),
      'deposit_received'
    );
    expect(mockedPopup).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('records a payment-request claim as a payee annotation and rotates only the standing request', async () => {
    const { unmount } = mount();
    useMintStore.getState().setStandingQuote('creq|sat', 'req-standing');
    const claim = (id: string, requestOperationId: string) => ({
      mintUrl: MINT,
      operation: {
        id,
        amount: 7,
        unit: 'sat',
        source: {
          type: 'payment-request',
          requestId: 'r1',
          transport: 'nostr',
          requestOperationId,
        },
      },
    });

    act(() => fake.emit('receive-op:finalized', claim('rop-1', 'req-other')));
    await flush();
    expect(annotation('op:rop-1')?.paymentRequest).toEqual({
      role: 'payee',
      requestId: 'r1',
      transport: 'nostr',
    });
    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'receive',
      id: 'rop-1',
      mintUrl: MINT,
      amount: 7,
      unit: 'sat',
    });
    expect(active()).toMatchObject({ variant: 'receive', id: 'rop-1', state: 'confirmed' });
    expect(mockedRotateCreq).not.toHaveBeenCalled();

    act(() => fake.emit('receive-op:finalized', claim('rop-2', 'req-standing')));
    await flush();
    expect(mockedRotateCreq).toHaveBeenCalledTimes(1);
    expect(mockedRotateCreq).toHaveBeenCalledWith(
      fake.manager,
      { unit: 'sat', mints: [MINT] },
      expect.any(Object)
    );
    unmount();
  });

  it('gives a waiting ecash receive a new confirmed toast under the history entry id', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'receive-ecash',
      id: 'token-1',
      mintUrl: MINT,
      amount: 10,
      unit: 'sat',
      state: 'waiting',
    });

    act(() =>
      fake.emit('history:updated', {
        mintUrl: MINT,
        entry: { type: 'receive', state: 'finalized', id: 'entry-9', amount: 10 },
      })
    );

    expect(active()).toMatchObject({
      variant: 'receive-ecash',
      id: 'entry-9',
      receiveEntryId: 'entry-9',
      state: 'confirmed',
    });
    expect(mockedPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'receive-ecash',
        id: 'entry-9',
        receiveEntryId: 'entry-9',
      })
    );
    unmount();
  });

  it('confirms a processing ecash receive in place when the receive finalizes', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'receive-ecash',
      id: 'token-1',
      mintUrl: MINT,
      amount: 10,
      unit: 'sat',
      state: 'processing',
    });

    act(() =>
      fake.emit('receive-op:finalized', {
        mintUrl: MINT,
        operation: { id: 'rop-9', amount: 10, unit: 'sat' },
      })
    );

    expect(active()).toMatchObject({ id: 'token-1', state: 'confirmed' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('confirms the toast of the send that finished, and no other payment’s', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'send',
      id: 'send-1',
      owner: { kind: 'send', operationId: 'send-1' },
      mintUrl: MINT,
      amount: 5,
      unit: 'sat',
      state: 'processing',
    });
    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'send-1',
        operation: { amount: 5, unit: 'sat' },
      })
    );
    expect(active()).toMatchObject({ id: 'send-1', state: 'confirmed', operationId: 'send-1' });

    usePaymentStatusStore.getState().setActive({
      variant: 'payment-request',
      id: 'pr-toast',
      owner: { kind: 'send', operationId: 'pr-send' },
      mintUrl: MINT,
      amount: 5,
      unit: 'sat',
      state: 'delivered',
    });
    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'unrelated-send',
        operation: { amount: 99, unit: 'sat' },
      })
    );
    // The delivered payment request is not confirmed by another send: that send
    // gets a toast of its own.
    expect(active()).toMatchObject({
      variant: 'send',
      id: 'unrelated-send',
      owner: { kind: 'send', operationId: 'unrelated-send' },
      state: 'confirmed',
    });
    expect(mockedPopup).toHaveBeenCalledWith(expect.objectContaining({ id: 'unrelated-send' }));
    unmount();
  });

  it('leaves a payment request still being paid alone when another send finishes', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'payment-request',
      id: 'pr-toast',
      owner: { kind: 'pending', key: 'pr-toast' },
      mintUrl: MINT,
      amount: 5,
      unit: 'sat',
      state: 'processing',
    });

    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'unrelated-send',
        operation: { amount: 5, unit: 'sat' },
      })
    );

    expect(active()).toEqual(expect.objectContaining({ id: 'pr-toast', state: 'processing' }));
    expect(active()).not.toHaveProperty('operationId');
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('confirms a payment request whose send finished before its flow bound the toast to it', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'payment-request',
      id: 'pr-toast',
      owner: { kind: 'pending', key: 'pr-toast' },
      mintUrl: MINT,
      amount: 5,
      unit: 'sat',
      state: 'processing',
    });
    // Delivered over HTTP: the send finishes while the toast is still held under its key.
    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'unrelated-send',
        operation: { amount: 5, unit: 'sat' },
      })
    );
    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'pr-send',
        operation: { amount: 5, unit: 'sat' },
      })
    );
    expect(active()).toMatchObject({ id: 'pr-toast', state: 'processing' });

    // The flow then binds its toast to its send and says it was delivered.
    act(() => {
      const store = usePaymentStatusStore.getState();
      store.bindOwner('pr-toast', { kind: 'send', operationId: 'pr-send' });
      store.setDelivered('pr-toast');
    });

    // The toast catches up with its send, and only its own.
    expect(active()).toMatchObject({
      id: 'pr-toast',
      owner: { kind: 'send', operationId: 'pr-send' },
      state: 'confirmed',
      operationId: 'pr-send',
    });
    unmount();
  });

  it('confirms a melt whose own melt finished before its flow bound the toast to its quote', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-toast',
      owner: { kind: 'pending', key: 'melt-toast' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'processing',
    });
    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'mo-a',
        operation: { quoteId: 'mq-a', amount: 300, unit: 'sat', method: 'bolt11' },
      })
    );
    expect(active()).toMatchObject({ id: 'melt-toast', state: 'processing' });

    act(() =>
      usePaymentStatusStore.getState().bindOwner('melt-toast', { kind: 'melt', quoteId: 'mq-a' })
    );

    expect(active()).toMatchObject({ id: 'melt-toast', state: 'confirmed', operationId: 'mo-a' });
    unmount();
  });

  it('raises a new confirmed send toast in the unit of a background send', () => {
    const { unmount } = mount();

    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'send-usd',
        operation: { amount: 500, unit: 'usd' },
      })
    );

    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'send',
      id: 'send-usd',
      mintUrl: MINT,
      amount: 500,
      unit: 'usd',
    });
    expect(active()).toMatchObject({
      variant: 'send',
      id: 'send-usd',
      unit: 'usd',
      state: 'confirmed',
    });
    unmount();
  });

  it('writes the onchain settlement facts of a finalized melt', async () => {
    const { unmount } = mount();
    fake.meltQuoteGet.mockResolvedValue({ fee_options: [{ fee_index: 1, fee_reserve: 300 }] });

    fake.emit('melt-op:finalized', {
      mintUrl: MINT,
      operationId: 'melt-op-1',
      operation: {
        quoteId: 'mq-1',
        amount: 10_000,
        unit: 'sat',
        method: 'onchain',
        finalizedData: { outpoint: 'ab:0' },
        methodData: { feeIndex: 1, address: 'bc1qexample', amountSats: 10_000 },
        effectiveFee: 250,
      },
    });
    fake.emit('melt-op:finalized', {
      mintUrl: MINT,
      operationId: 'melt-op-2',
      operation: { quoteId: 'mq-2', amount: 10, unit: 'sat', method: 'onchain', methodData: {} },
    });
    await flush();

    expect(fake.meltQuoteGet).toHaveBeenCalledWith({ mintUrl: MINT, quoteId: 'mq-1' });
    expect(annotation('quote:mq-1')?.onchainMelt).toEqual({
      outpoint: 'ab:0',
      outpointSource: 'mint',
      feeIndex: 1,
      feeReserveSats: 300,
      effectiveFeeSats: 250,
      address: 'bc1qexample',
      amountSats: 10_000,
    });
    expect(annotation('quote:mq-2')?.onchainMelt).toEqual({ settledOffchain: true });
    unmount();
  });

  it('gives another melt its own toast instead of the one shown, and a background melt toast says its unit', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-toast-123',
      owner: { kind: 'melt', quoteId: 'mq-123' },
      mintUrl: 'https://other.example',
      amount: 1,
      unit: 'sat',
      state: 'confirmed',
    });

    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'melt-op-x',
        operation: { quoteId: 'mq-x', amount: 900, unit: 'sat', method: 'bolt11' },
      })
    );
    // The confirmed toast of another melt keeps its own View target; this melt gets
    // a toast of its own.
    expect(active()).toMatchObject({
      id: 'mq-x',
      owner: { kind: 'melt', quoteId: 'mq-x' },
      state: 'confirmed',
    });
    expect(mockedPopup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mq-x', operationId: 'melt-op-x' })
    );
    mockedPopup.mockClear();

    usePaymentStatusStore.getState().setActive(null);
    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'melt-op-usd',
        operation: { quoteId: 'mq-usd', amount: 500, unit: 'usd', method: 'bolt11' },
      })
    );
    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'melt',
      id: 'mq-usd',
      mintUrl: MINT,
      amount: 500,
      unit: 'usd',
      operationId: 'melt-op-usd',
    });
    unmount();
  });

  it('leaves a melt in flight alone when another melt finishes or rolls back, then confirms it by its own', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-a',
      owner: { kind: 'melt', quoteId: 'mq-a' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'processing',
    });

    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'mo-b',
        operation: { quoteId: 'mq-b', amount: 300, unit: 'sat', method: 'bolt11' },
      })
    );
    expect(active()).toEqual(expect.objectContaining({ id: 'melt-a', state: 'processing' }));
    expect(active()).not.toHaveProperty('operationId');
    expect(mockedPopup).not.toHaveBeenCalled();

    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'mo-a',
        operation: { quoteId: 'mq-a', amount: 300, unit: 'sat', method: 'bolt11' },
      })
    );
    expect(active()).toMatchObject({ id: 'melt-a', state: 'confirmed', operationId: 'mo-a' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('shows another melt’s success, left to a melt in flight, once that toast ends', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-a',
      owner: { kind: 'melt', quoteId: 'mq-a' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'processing',
    });
    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'mo-b',
        operation: { quoteId: 'mq-b', amount: 200, unit: 'sat', method: 'bolt11' },
      })
    );
    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'mo-a',
        operation: { quoteId: 'mq-a', amount: 300, unit: 'sat', method: 'bolt11' },
      })
    );
    expect(active()).toMatchObject({ id: 'melt-a', state: 'confirmed' });
    expect(mockedPopup).not.toHaveBeenCalled();

    // Melt A's toast is dismissed: melt B's success is shown, once.
    act(() => usePaymentStatusStore.getState().clearActive('melt-a'));
    expect(active()).toMatchObject({
      variant: 'melt',
      id: 'mq-b',
      owner: { kind: 'melt', quoteId: 'mq-b' },
      amount: 200,
      state: 'confirmed',
    });
    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'melt',
      id: 'mq-b',
      mintUrl: MINT,
      amount: 200,
      unit: 'sat',
      operationId: 'mo-b',
    });
    act(() => usePaymentStatusStore.getState().clearActive('mq-b'));
    expect(active()).toBeNull();
    expect(mockedPopup).toHaveBeenCalledTimes(1);
    unmount();
  });

  describe('a held success whose event comes again', () => {
    const meltB = {
      mintUrl: MINT,
      operationId: 'mo-b',
      operation: { quoteId: 'mq-b', amount: 200, unit: 'sat', method: 'bolt11' },
    };
    function holdBBesideMeltA() {
      usePaymentStatusStore.getState().setActive({
        variant: 'melt',
        id: 'melt-a',
        owner: { kind: 'melt', quoteId: 'mq-a' },
        mintUrl: MINT,
        amount: 300,
        unit: 'sat',
        state: 'processing',
      });
      act(() => fake.emit('melt-op:finalized', meltB));
      act(() =>
        fake.emit('melt-op:finalized', {
          mintUrl: MINT,
          operationId: 'mo-a',
          operation: { quoteId: 'mq-a', amount: 300, unit: 'sat', method: 'bolt11' },
        })
      );
      expect(active()).toMatchObject({ id: 'melt-a', state: 'confirmed' });
    }
    const popupsOfB = () => mockedPopup.mock.calls.filter(([popup]) => popup.id === 'mq-b').length;

    it('is shown once when it comes again after the toast in flight confirmed', () => {
      const { unmount } = mount();
      holdBBesideMeltA();

      act(() => fake.emit('melt-op:finalized', meltB));
      expect(active()).toMatchObject({ id: 'mq-b', state: 'confirmed' });
      act(() => usePaymentStatusStore.getState().clearActive('mq-b'));

      expect(active()).toBeNull();
      expect(popupsOfB()).toBe(1);
      unmount();
    });

    it('is not shown again when it comes again after it was shown from the hold', () => {
      const { unmount } = mount();
      holdBBesideMeltA();
      act(() => usePaymentStatusStore.getState().clearActive('melt-a'));
      expect(active()).toMatchObject({ id: 'mq-b', state: 'confirmed' });
      act(() => usePaymentStatusStore.getState().clearActive('mq-b'));

      act(() => fake.emit('melt-op:finalized', meltB));

      expect(active()).toBeNull();
      expect(popupsOfB()).toBe(1);
      unmount();
    });
  });

  it('shows another send’s success, left to a payment request in flight, once that toast ends', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'payment-request',
      id: 'pr-toast',
      owner: { kind: 'pending', key: 'pr-toast' },
      mintUrl: MINT,
      amount: 5,
      unit: 'sat',
      state: 'processing',
    });
    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'send-c',
        operation: { amount: 7, unit: 'sat' },
      })
    );
    expect(mockedPopup).not.toHaveBeenCalled();

    // The payment request's flow ends its toast without this send: it was another's.
    act(() => usePaymentStatusStore.getState().clearActive('pr-toast'));
    expect(active()).toMatchObject({ variant: 'send', id: 'send-c', state: 'confirmed' });
    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'send',
      id: 'send-c',
      mintUrl: MINT,
      amount: 7,
      unit: 'sat',
    });
    unmount();
  });

  it('does not fail a melt in flight for another melt’s rollback of the same amount', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-a',
      owner: { kind: 'melt', quoteId: 'mq-a' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'processing',
    });

    act(() =>
      fake.emit('melt-op:rolled-back', {
        mintUrl: MINT,
        operation: { id: 'mo-b', quoteId: 'mq-b', amount: 300, unit: 'sat', error: 'boom' },
      })
    );

    // The other melt's failure is shown, as its own toast: funds coming back are never silent.
    expect(active()).toMatchObject({
      id: 'mq-b',
      owner: { kind: 'melt', quoteId: 'mq-b' },
      state: 'failed',
    });
    expect(mockedPopup).toHaveBeenCalledWith(expect.objectContaining({ id: 'mq-b' }));
    unmount();
  });

  it('fails a matching processing melt toast on rollback and does not stack a second one', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-toast',
      owner: { kind: 'melt', quoteId: 'mq-1' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'processing',
    });
    const rollback = {
      mintUrl: MINT,
      operation: { id: 'mo-1', quoteId: 'mq-1', amount: 300, unit: 'sat', error: 'boom' },
    };

    act(() => fake.emit('melt-op:rolled-back', rollback));
    expect(active()).toMatchObject({ id: 'melt-toast', state: 'failed' });

    act(() => fake.emit('melt-op:rolled-back', rollback));
    expect(active()).toMatchObject({ id: 'melt-toast', state: 'failed' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('raises a failed melt toast for a rollback with no matching toast', () => {
    const { unmount } = mount();

    act(() =>
      fake.emit('melt-op:rolled-back', {
        mintUrl: MINT,
        operation: { id: 'mo-2', quoteId: 'mq-2', amount: 40, unit: 'usd' },
      })
    );

    expect(active()).toMatchObject({
      variant: 'melt',
      id: 'mq-2',
      unit: 'usd',
      state: 'failed',
      errorMessage: 'Payment was rolled back',
    });
    expect(mockedPopup).toHaveBeenCalledWith({
      variant: 'melt',
      id: 'mq-2',
      mintUrl: MINT,
      amount: 40,
      unit: 'usd',
    });
    unmount();
  });

  it('confirms a processing melt toast in place when its melt finishes, keeping that melt for View', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-toast',
      owner: { kind: 'melt', quoteId: 'mq-1' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'processing',
    });

    act(() =>
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'mo-1',
        operation: { quoteId: 'mq-1', amount: 300, unit: 'sat', method: 'bolt11' },
      })
    );

    expect(active()).toMatchObject({ id: 'melt-toast', state: 'confirmed', operationId: 'mo-1' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('confirms a delivered payment-request toast when its send finishes', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'payment-request',
      id: 'pr-toast',
      owner: { kind: 'send', operationId: 'pr-send' },
      mintUrl: MINT,
      amount: 5,
      unit: 'sat',
      state: 'delivered',
    });

    act(() =>
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 'pr-send',
        operation: { amount: 5, unit: 'sat' },
      })
    );

    expect(active()).toMatchObject({ id: 'pr-toast', state: 'confirmed', operationId: 'pr-send' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('does not stack a failed toast on one the payment flow already failed for the same rollback', () => {
    const { unmount } = mount();
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'melt-failed-fresh',
      owner: { kind: 'pending', key: 'melt-failed-fresh' },
      mintUrl: MINT,
      amount: 300,
      unit: 'sat',
      state: 'failed',
      errorMessage: 'Route failed',
    });

    act(() =>
      fake.emit('melt-op:rolled-back', {
        mintUrl: MINT,
        operation: { id: 'mo-1', quoteId: 'mq-1', amount: 300, unit: 'sat', error: 'boom' },
      })
    );

    expect(active()).toMatchObject({ id: 'melt-failed-fresh', errorMessage: 'Route failed' });
    expect(mockedPopup).not.toHaveBeenCalled();
    unmount();
  });

  it('stays silent while a swap is running', async () => {
    const { unmount } = mount();
    startSwap();

    act(() => {
      fake.emit('mint-quote:updated', {
        mintUrl: MINT,
        method: 'bolt11',
        quoteId: 'q1',
        quote: { method: 'bolt11', state: 'PAID', amount: 1, unit: 'sat' },
      });
      fake.emit('mint-op:finalized', {
        mintUrl: MINT,
        operationId: 'o1',
        operation: { quoteId: 'q2', method: 'bolt12', unit: 'sat', amount: 1 },
      });
      fake.emit('receive-op:finalized', {
        mintUrl: MINT,
        operation: { id: 'r1', amount: 1, unit: 'sat', source: { type: 'payment-request' } },
      });
      fake.emit('send:finalized', {
        mintUrl: MINT,
        operationId: 's1',
        operation: { amount: 1, unit: 'sat' },
      });
      fake.emit('melt-op:finalized', {
        mintUrl: MINT,
        operationId: 'm1',
        operation: { quoteId: 'mq', amount: 1, unit: 'sat', method: 'bolt11' },
      });
      fake.emit('melt-op:rolled-back', {
        mintUrl: MINT,
        operation: { id: 'm2', quoteId: 'mq2', amount: 1, unit: 'sat' },
      });
    });
    await flush();

    expect(mockedPopup).not.toHaveBeenCalled();
    expect(active()).toBeNull();
    expect(annotation('op:r1')).toBeUndefined();
    unmount();
  });

  it('subscribes to nine wallet events and removes every listener on unmount', () => {
    const { unmount } = mount();
    expect(fake.manager.on).toHaveBeenCalledTimes(9);
    expect(fake.listenerCount()).toBe(9);

    unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
