/**
 * @jest-environment node
 */

import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { RECEIVE_PENDING_TOAST_COPY } from '@/shared/lib/popup/paymentStatusCopy';
import { paymentLog } from '@/shared/lib/logger';

jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('paymentStatusStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePaymentStatusStore.setState(usePaymentStatusStore.getInitialState());
  });

  it('marks recoverable receive failures as waiting with custom copy', () => {
    usePaymentStatusStore.getState().setActive({
      variant: 'receive-ecash',
      id: 'token-hash',
      mintUrl: 'https://mint.example.com',
      amount: 21,
      unit: 'sat',
      state: 'processing',
    });

    usePaymentStatusStore.getState().setWaiting('token-hash', RECEIVE_PENDING_TOAST_COPY);

    expect(usePaymentStatusStore.getState().active).toMatchObject({
      id: 'token-hash',
      state: 'waiting',
      titleOverride: 'Ecash ready to redeem',
      subtitleOverride: "We'll add it to your wallet when you're back online.",
    });
  });

  it('does not mutate a waiting receive into confirmed', () => {
    usePaymentStatusStore.getState().setActive({
      variant: 'receive-ecash',
      id: 'token-hash',
      mintUrl: 'https://mint.example.com',
      amount: 21,
      unit: 'sat',
      state: 'waiting',
      titleOverride: RECEIVE_PENDING_TOAST_COPY.title,
      subtitleOverride: RECEIVE_PENDING_TOAST_COPY.subtitle,
    });

    usePaymentStatusStore.getState().setConfirmed('token-hash', { receiveEntryId: 'receive:op' });

    expect(usePaymentStatusStore.getState().active).toMatchObject({
      id: 'token-hash',
      state: 'waiting',
      titleOverride: RECEIVE_PENDING_TOAST_COPY.title,
      subtitleOverride: RECEIVE_PENDING_TOAST_COPY.subtitle,
    });
  });

  it('does not mutate a waiting receive into failed', () => {
    usePaymentStatusStore.getState().setActive({
      variant: 'receive-ecash',
      id: 'token-hash',
      mintUrl: 'https://mint.example.com',
      amount: 21,
      unit: 'sat',
      state: 'waiting',
      titleOverride: RECEIVE_PENDING_TOAST_COPY.title,
      subtitleOverride: RECEIVE_PENDING_TOAST_COPY.subtitle,
    });

    usePaymentStatusStore.getState().setFailed('token-hash', new Error('Token was spent'));

    expect(usePaymentStatusStore.getState().active).toMatchObject({
      id: 'token-hash',
      state: 'waiting',
      titleOverride: RECEIVE_PENDING_TOAST_COPY.title,
      subtitleOverride: RECEIVE_PENDING_TOAST_COPY.subtitle,
    });
  });

  it('clears only the requested active payment id', () => {
    usePaymentStatusStore.getState().setActive({
      variant: 'receive-ecash',
      id: 'new-success',
      mintUrl: 'https://mint.example.com',
      amount: 21,
      unit: 'sat',
      state: 'confirmed',
    });

    usePaymentStatusStore.getState().clearActive('old-warning');
    expect(usePaymentStatusStore.getState().active?.id).toBe('new-success');
    expect(paymentLog.debug).toHaveBeenCalledWith(
      'payment.status.clear_active.skipped',
      expect.objectContaining({
        requestedId: 'old-warning',
        activeId: 'new-success',
        reason: 'id_mismatch',
      })
    );

    usePaymentStatusStore.getState().clearActive('new-success');
    expect(usePaymentStatusStore.getState().active).toBeNull();
  });
});

it('presents wrapped mint errors through the shared catalog in the payment toast state', () => {
  const store = usePaymentStatusStore.getState();
  store.setActive({
    id: 'failed-receive',
    variant: 'receive-ecash',
    state: 'processing',
    mintUrl: 'https://mint.invalid',
    amount: 21,
    unit: 'sat',
  });
  store.setFailed(
    'failed-receive',
    new Error('Coco receive failed', {
      cause: { code: 20002, detail: 'quote already issued' },
    })
  );
  expect(usePaymentStatusStore.getState().active).toMatchObject({
    state: 'failed',
    errorMessage:
      'The mint has already issued ecash for this quote. Check transaction history or use wallet recovery.',
  });
});

describe('binding a toast to its payment', () => {
  const processingMelt = {
    variant: 'melt' as const,
    id: 'melt-1',
    owner: { kind: 'pending' as const, key: 'melt-1' },
    mintUrl: 'https://mint.example',
    amount: 10,
    unit: 'sat',
    state: 'processing' as const,
  };

  it('binds the toast its starter opened under the key', () => {
    usePaymentStatusStore.getState().setActive(processingMelt);
    usePaymentStatusStore.getState().bindOwner('melt-1', { kind: 'melt', quoteId: 'mq-1' });
    expect(usePaymentStatusStore.getState().active).toMatchObject({
      id: 'melt-1',
      owner: { kind: 'melt', quoteId: 'mq-1' },
      state: 'processing',
    });
  });

  it('binds nothing under another key, and never rebinds a bound toast', () => {
    usePaymentStatusStore.getState().setActive(processingMelt);
    usePaymentStatusStore.getState().bindOwner('melt-2', { kind: 'melt', quoteId: 'mq-2' });
    expect(usePaymentStatusStore.getState().active?.id).toBe('melt-1');
    expect(usePaymentStatusStore.getState().active).toMatchObject({
      owner: { kind: 'pending', key: 'melt-1' },
    });

    usePaymentStatusStore.getState().bindOwner('melt-1', { kind: 'melt', quoteId: 'mq-1' });
    usePaymentStatusStore.getState().bindOwner('melt-1', { kind: 'melt', quoteId: 'mq-other' });
    expect(usePaymentStatusStore.getState().active).toMatchObject({
      owner: { kind: 'melt', quoteId: 'mq-1' },
    });
  });
});

describe('results held for a toast still waiting to be bound', () => {
  const MINT = 'https://mint.example';
  beforeEach(() => usePaymentStatusStore.setState(usePaymentStatusStore.getInitialState()));

  const meltResult = (quoteId: string) => {
    const owner = { kind: 'melt' as const, quoteId };
    return {
      owner,
      operationId: `op-${quoteId}`,
      toast: {
        variant: 'melt' as const,
        id: quoteId,
        owner,
        mintUrl: MINT,
        amount: 10,
        unit: 'sat',
        state: 'confirmed' as const,
      },
    };
  };
  const waitingMelt = (key: string) =>
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: key,
      owner: { kind: 'pending', key },
      mintUrl: MINT,
      amount: 10,
      unit: 'sat',
      state: 'processing',
    });

  it('keeps the waiting toast’s own result however many others are held after it', () => {
    waitingMelt('toast');
    const store = usePaymentStatusStore.getState();
    store.deliverResult(meltResult('own'), ['melt']);
    for (let i = 0; i < 25; i += 1) store.deliverResult(meltResult(`other-${i}`), ['melt']);

    usePaymentStatusStore.getState().bindOwner('toast', { kind: 'melt', quoteId: 'own' });

    expect(usePaymentStatusStore.getState().active).toMatchObject({
      id: 'toast',
      state: 'confirmed',
      operationId: 'op-own',
    });
  });

  it('still drops the oldest results once no toast is waiting for them', () => {
    usePaymentStatusStore.getState().setActive({
      variant: 'melt',
      id: 'bound',
      owner: { kind: 'melt', quoteId: 'bound' },
      mintUrl: MINT,
      amount: 10,
      unit: 'sat',
      state: 'processing',
    });
    const store = usePaymentStatusStore.getState();
    for (let i = 0; i < 25; i += 1) store.deliverResult(meltResult(`other-${i}`), ['melt']);

    const held = usePaymentStatusStore.getState().held;
    expect(held).toHaveLength(20);
    expect(held[0]?.owner).toEqual({ kind: 'melt', quoteId: 'other-5' });
  });
});
