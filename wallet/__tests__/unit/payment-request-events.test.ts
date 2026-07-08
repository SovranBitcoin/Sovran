/**
 * DO NOT modify tests to make them pass.
 *
 * paymentRequestEvents — the in-package signal that surfaces a freshly created
 * incoming payment request in the transactions list (coco emits nothing on
 * incoming.create).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  emitPaymentRequestCreated,
  onPaymentRequestCreated,
} from '../../src/paymentRequestEvents';

describe('paymentRequestEvents', () => {
  it('notifies subscribers on emit and stops after unsubscribe', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onPaymentRequestCreated(a);
    const offB = onPaymentRequestCreated(b);

    emitPaymentRequestCreated();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    emitPaymentRequestCreated();
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed
    expect(b).toHaveBeenCalledTimes(2);

    offB();
    emitPaymentRequestCreated();
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('emit with no subscribers is a no-op', () => {
    expect(() => emitPaymentRequestCreated()).not.toThrow();
  });
});
