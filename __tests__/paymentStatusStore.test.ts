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
    usePaymentStatusStore.getState().setActive(null);
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
