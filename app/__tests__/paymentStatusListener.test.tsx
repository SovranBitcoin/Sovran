/**
 * @jest-environment node
 *
 * `usePaymentStatusListener`: what each Coco wallet event reports to the
 * payment toasts, the saved transaction annotations and the standing quotes.
 * The hook runs against the real payment toasts, swap status, mint and
 * annotation stores; only the Coco manager and the two wallet rotation calls
 * are replaced.
 *
 * A toast is read here as what is known about its payment (`paymentToasts`),
 * whether or not it is on screen yet; what is drawn when is the machine's
 * (`paymentToastMachine.test.ts`) and the stack's (`paymentToastBehaviour.test.tsx`).
 */

import { act, renderHook } from '@testing-library/react-native';

import { Amount } from '@cashu/coco-core';
import { useManagerContext } from '@cashu/coco-react';
import { decodeAnnotation, rotateReusableMintQuote, rotateStandingPaymentRequest } from 'wallet';

import { usePaymentStatusListener } from '@/shared/hooks/usePaymentStatusListener';
import {
  paymentToasts,
  toastKey,
  type PaymentToastContent,
} from '@/shared/stores/runtime/paymentStatusStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useTransactionAnnotationStore } from '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('@cashu/coco-react', () => ({
  useManagerContext: jest.fn(),
}));

jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  rotateReusableMintQuote: jest.fn(() => Promise.resolve()),
  rotateStandingPaymentRequest: jest.fn(() => Promise.resolve()),
}));

const mockedUseManagerContext = jest.mocked(useManagerContext);
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

/** Every payment with a toast, as `key:phase`. */
const toasts = () => paymentToasts.tracked().map((toast) => `${toast.key}:${toast.phase}`);
const toast = (key: string) => paymentToasts.get(key);

const payment = (
  variant: 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request',
  amount: number,
  extra: Partial<Extract<PaymentToastContent, { kind: 'payment' }>> = {}
): PaymentToastContent => ({
  kind: 'payment',
  variant,
  mintUrl: MINT,
  amount,
  unit: 'sat',
  ...extra,
});

function annotation(key: string) {
  const record = useTransactionAnnotationStore.getState().annotations[key];
  return record ? decodeAnnotation(record) : undefined;
}

function startSwap() {
  useSwapStatusStore
    .getState()
    .start({ id: 'swap-1', legs: [{ id: 'leg' }], meta: { unit: 'sat' } });
}

const sendFinalized = (operationId: string, amount = 5, unit = 'sat') =>
  act(() =>
    fake.emit('send:finalized', { mintUrl: MINT, operationId, operation: { amount, unit } })
  );
const meltFinalized = (quoteId: string, operationId: string, amount = 300, unit = 'sat') =>
  act(() =>
    fake.emit('melt-op:finalized', {
      mintUrl: MINT,
      operationId,
      operation: { quoteId, amount, unit, method: 'bolt11' },
    })
  );
const meltRolledBack = (quoteId: string, amount = 300, error = 'Route failed') =>
  act(() =>
    fake.emit('melt-op:rolled-back', {
      mintUrl: MINT,
      operation: { id: `mo-${quoteId}`, quoteId, amount, unit: 'sat', error },
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  paymentToasts.dismissAll();
  useSwapStatusStore.setState({ active: null });
  useMintStore.setState({ standingQuotes: {} });
  useTransactionAnnotationStore.setState({ annotations: {} });
  fake = createFakeManager();
});

afterEach(() => {
  // Toasts in flight hold timers: none may outlive its test.
  paymentToasts.dismissAll();
  jest.restoreAllMocks();
});

describe('usePaymentStatusListener', () => {
  it('starts one receive toast for a paid bolt11 quote and ignores other methods', () => {
    const { unmount } = mount();
    const paid = { method: 'bolt11', state: 'PAID', amount: 21, unit: 'sat' };
    const updated = (quoteId: string, quote: Record<string, unknown>) =>
      act(() =>
        fake.emit('mint-quote:updated', { mintUrl: MINT, method: quote.method, quoteId, quote })
      );

    updated('q1', paid);
    updated('q1', paid);
    updated('q2', { ...paid, method: 'bolt12' });
    updated('q3', { ...paid, state: 'UNPAID' });

    expect(toasts()).toEqual(['mint:q1:working']);
    expect(toast('mint:q1')?.content).toEqual(
      payment('receive', 21, { target: { type: 'mint', quoteId: 'q1' } })
    );
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
    expect(toasts()).toEqual([]);

    fake.emit('mint-op:pending', pending('op-12', 'q-12', 'bolt12'));
    await flush();
    expect(fake.mintQuoteGet).toHaveBeenCalledTimes(1);

    fake.mintQuoteGet.mockResolvedValueOnce(paidQuote(Date.now() - 60 * 1000));
    fake.emit('mint-op:pending', pending('op-new', 'q-new'));
    await flush();
    expect(fake.mintQuoteGet).toHaveBeenLastCalledWith({ mintUrl: MINT, quoteId: 'q-new' });
    expect(toasts()).toEqual(['mint:q-new:working']);
    expect(toast('mint:q-new')?.content).toMatchObject({ variant: 'receive', amount: 50 });
    unmount();
  });

  it('finishes a receive toast when its mint finalizes, and starts none for a bolt11 mint that had none', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.mint('q1'), payment('receive', 21));
    const finalized = (quoteId: string) =>
      act(() =>
        fake.emit('mint-op:finalized', {
          mintUrl: MINT,
          operationId: `op-${quoteId}`,
          operation: { quoteId, method: 'bolt11', unit: 'sat', amount: 21 },
        })
      );

    finalized('q1');
    // A bolt11 mint whose paid toast was held back (a stale replay) stays untold.
    finalized('q-untold');

    expect(toasts()).toEqual(['mint:q1:done']);
    unmount();
  });

  it('tells a reusable deposit as received and rotates only the standing onchain quote', () => {
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
    expect(toasts()).toEqual(['mint:q-other:done']);
    expect(toast('mint:q-other')?.content).toEqual(
      payment('receive', 1000, { target: { type: 'mint', quoteId: 'q-other' } })
    );

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
    expect(toasts()).toEqual(['mint:q-other:done', 'mint:q-standing:done']);
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
    expect(toasts()).toEqual(['receive:rop-1:done']);
    expect(toast('receive:rop-1')?.content).toEqual(
      payment('receive', 7, { target: { type: 'receive', operationId: 'rop-1' } })
    );
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

  it('finishes a waiting ecash receive in its own toast, with the history entry to open', () => {
    const { unmount } = mount();
    paymentToasts.report(
      toastKey.receive('token-1'),
      'slow',
      payment('receive-ecash', 10, { title: 'Ecash ready to redeem', subtitle: 'Later' })
    );

    act(() =>
      fake.emit('history:updated', {
        mintUrl: MINT,
        entry: { type: 'receive', state: 'finalized', id: 'entry-9', amount: 10 },
      })
    );

    expect(toasts()).toEqual(['receive:token-1:done']);
    // The wording of the wait is gone; the entry to open is known.
    expect(toast('receive:token-1')?.content).toEqual(
      payment('receive-ecash', 10, { target: { type: 'receive', entryId: 'entry-9' } })
    );
    unmount();
  });

  it('finishes a working ecash receive in place when the receive finalizes, then learns its entry', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.receive('token-1'), payment('receive-ecash', 10));

    act(() =>
      fake.emit('receive-op:finalized', {
        mintUrl: MINT,
        operation: { id: 'rop-9', amount: 10, unit: 'sat' },
      })
    );
    expect(toasts()).toEqual(['receive:token-1:done']);

    act(() =>
      fake.emit('history:updated', {
        mintUrl: MINT,
        entry: { type: 'receive', state: 'finalized', id: 'entry-9', amount: 10 },
      })
    );
    expect(toasts()).toEqual(['receive:token-1:done']);
    expect(toast('receive:token-1')?.content).toMatchObject({
      target: { type: 'receive', entryId: 'entry-9' },
    });
    unmount();
  });

  it('does not take a receive that finishes for a redeem that already failed', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.receive('token-1'), payment('receive-ecash', 10));
    paymentToasts.report(
      toastKey.receive('token-1'),
      'failed',
      payment('receive-ecash', 10, { subtitle: 'Already spent' })
    );

    // Another receive of the same amount from the same mint.
    act(() =>
      fake.emit('receive-op:finalized', {
        mintUrl: MINT,
        operation: { id: 'rop-9', amount: 10, unit: 'sat' },
      })
    );
    expect(toasts()).toEqual(['receive:token-1:failed']);
    unmount();
  });

  it('leaves ecash receives of another mint or amount alone', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.receive('token-1'), payment('receive-ecash', 10));

    act(() =>
      fake.emit('receive-op:finalized', {
        mintUrl: MINT,
        operation: { id: 'rop-9', amount: 11, unit: 'sat' },
      })
    );
    act(() =>
      fake.emit('history:updated', {
        mintUrl: 'https://other.example',
        entry: { type: 'receive', state: 'finalized', id: 'entry-9', amount: 10 },
      })
    );
    expect(toasts()).toEqual(['receive:token-1:working']);
    unmount();
  });

  it('finishes the toast of the send that finished, and no other payment’s', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.send('send-1'), payment('send', 5));
    paymentToasts.report(toastKey.send('pr-send'), 'handed-off', payment('payment-request', 5));

    sendFinalized('send-1');
    expect(toasts()).toEqual(['send:send-1:done', 'send:pr-send:handed-off']);

    // The delivered payment request is not finished by another send: that
    // send gets a toast of its own.
    sendFinalized('unrelated-send', 99);
    expect(toasts()).toEqual([
      'send:send-1:done',
      'send:pr-send:handed-off',
      'send:unrelated-send:done',
    ]);
    expect(toast('send:unrelated-send')?.content).toEqual(
      payment('send', 99, { target: { type: 'send', operationId: 'unrelated-send' } })
    );
    unmount();
  });

  it('finishes a delivered payment-request toast when its send finishes, still as a payment request', () => {
    const { unmount } = mount();
    paymentToasts.report(toastKey.send('pr-send'), 'handed-off', payment('payment-request', 5));

    sendFinalized('pr-send');

    expect(toasts()).toEqual(['send:pr-send:done']);
    expect(toast('send:pr-send')?.content).toEqual(
      payment('payment-request', 5, { target: { type: 'send', operationId: 'pr-send' } })
    );
    unmount();
  });

  it('holds a send that finishes while a payment request has no id yet, and lands it on that toast if it was its own', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.pending('pr'), payment('payment-request', 5), {
      unbound: { group: 'send' },
    });

    // Delivered over HTTP: the send finishes before the flow knows its id.
    sendFinalized('unrelated-send');
    sendFinalized('pr-send');
    expect(toasts()).toEqual(['pending:pr:working']);

    // The flow then binds its toast to its send.
    act(() => paymentToasts.bind(toastKey.pending('pr'), toastKey.send('pr-send'), ['pr-send']));

    // The toast catches up with its own send; the other gets a toast of its own.
    expect(toasts()).toEqual(['send:pr-send:done', 'send:unrelated-send:done']);
    expect(toast('send:pr-send')?.content).toEqual(
      payment('payment-request', 5, { target: { type: 'send', operationId: 'pr-send' } })
    );
    unmount();
  });

  it('lands a melt that finished before its toast knew its quote on that toast', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.pending('melt'), payment('melt', 300), {
      unbound: { group: 'melt' },
    });

    meltFinalized('mq-a', 'mo-a');
    expect(toasts()).toEqual(['pending:melt:working']);

    act(() => paymentToasts.bind(toastKey.pending('melt'), toastKey.melt('mq-a'), ['mq-a']));

    expect(toasts()).toEqual(['melt:mq-a:done']);
    expect(toast('melt:mq-a')?.content).toMatchObject({
      target: { type: 'melt', quoteId: 'mq-a' },
    });
    unmount();
  });

  it('tells a background send as sent, in its unit', () => {
    const { unmount } = mount();
    sendFinalized('send-usd', 500, 'usd');
    expect(toasts()).toEqual(['send:send-usd:done']);
    expect(toast('send:send-usd')?.content).toMatchObject({ variant: 'send', unit: 'usd' });
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

  it('gives two melts in flight a toast each: neither’s result touches the other', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.melt('mq-a'), payment('melt', 300));
    paymentToasts.start(toastKey.melt('mq-b'), payment('melt', 300));

    meltFinalized('mq-b', 'mo-b');
    expect(toasts()).toEqual(['melt:mq-a:working', 'melt:mq-b:done']);

    meltRolledBack('mq-c');
    expect(toasts()).toEqual(['melt:mq-a:working', 'melt:mq-b:done', 'melt:mq-c:failed']);

    meltFinalized('mq-a', 'mo-a');
    expect(toasts()).toEqual(['melt:mq-a:done', 'melt:mq-b:done', 'melt:mq-c:failed']);
    unmount();
  });

  it('tells a result once: the same event delivered again changes nothing', () => {
    jest.useFakeTimers();
    try {
      const { unmount } = mount();
      meltFinalized('mq-b', 'mo-b');
      expect(toasts()).toEqual(['melt:mq-b:done']);
      act(() => void jest.advanceTimersByTime(10_000));
      expect(toasts()).toEqual([]);

      meltFinalized('mq-b', 'mo-b');
      expect(toasts()).toEqual([]);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails a melt toast on its rollback, keeps the reason its flow gave, and lets a later success correct it', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.melt('mq-1'), payment('melt', 300));

    meltRolledBack('mq-1');
    expect(toasts()).toEqual(['melt:mq-1:failed']);
    expect(toast('melt:mq-1')?.content).toMatchObject({ subtitle: expect.any(String) });

    // The flow failed its own toast first, in its own words: the rollback
    // event that follows does not reword it.
    paymentToasts.start(toastKey.melt('mq-2'), payment('melt', 300));
    paymentToasts.report(
      toastKey.melt('mq-2'),
      'failed',
      payment('melt', 300, { subtitle: 'In the flow’s words' })
    );
    meltRolledBack('mq-2');
    expect(toast('melt:mq-2')?.content).toMatchObject({ subtitle: 'In the flow’s words' });
    paymentToasts.dismiss(toastKey.melt('mq-2'));

    meltFinalized('mq-1', 'mo-1');
    expect(toasts()).toEqual(['melt:mq-1:done']);
    expect(toast('melt:mq-1')?.content).not.toHaveProperty('subtitle');
    unmount();
  });

  it('tells a rollback with no toast of its own as a failed melt', () => {
    const { unmount } = mount();
    meltRolledBack('mq-9', 50);
    expect(toasts()).toEqual(['melt:mq-9:failed']);
    expect(toast('melt:mq-9')?.content).toMatchObject({
      variant: 'melt',
      amount: 50,
      target: { type: 'melt', quoteId: 'mq-9' },
      subtitle: expect.any(String),
    });
    unmount();
  });

  it('does not stack a failed toast on one the payment flow already failed for the same rollback', () => {
    const { unmount } = mount();
    paymentToasts.report(
      toastKey.pending('melt-failed'),
      'failed',
      payment('melt', 300, { subtitle: 'Route failed' })
    );

    meltRolledBack('mq-1');

    expect(toasts()).toEqual(['pending:melt-failed:failed']);
    unmount();
  });

  // T9: the rollback arrives before the flow has failed its own toast.
  it('leaves a rollback to the flow whose toast is still waiting to learn its quote', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.pending('melt'), payment('melt', 300), {
      unbound: { group: 'melt' },
    });

    meltRolledBack('mq-1');

    expect(toasts()).toEqual(['pending:melt:working']);
    unmount();
  });

  it('does not take another melt’s rollback of a different amount for the waiting flow’s', () => {
    const { unmount } = mount();
    paymentToasts.start(toastKey.pending('melt'), payment('melt', 300), {
      unbound: { group: 'melt' },
    });

    meltRolledBack('mq-b', 999);

    expect(toasts()).toEqual(['pending:melt:working', 'melt:mq-b:failed']);
    unmount();
  });

  it('stays silent while a swap is running', async () => {
    const { unmount } = mount();
    startSwap();

    act(() =>
      fake.emit('mint-quote:updated', {
        mintUrl: MINT,
        method: 'bolt11',
        quoteId: 'q1',
        quote: { method: 'bolt11', state: 'PAID', amount: 21, unit: 'sat' },
      })
    );
    act(() =>
      fake.emit('mint-op:finalized', {
        mintUrl: MINT,
        operationId: 'op-1',
        operation: { quoteId: 'q2', method: 'onchain', unit: 'sat', amount: 5 },
      })
    );
    act(() =>
      fake.emit('receive-op:finalized', {
        mintUrl: MINT,
        operation: { id: 'r1', amount: 1, unit: 'sat', source: { type: 'payment-request' } },
      })
    );
    sendFinalized('s1');
    meltFinalized('mq', 'mo');
    meltRolledBack('mq2');
    await flush();

    expect(toasts()).toEqual([]);
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
