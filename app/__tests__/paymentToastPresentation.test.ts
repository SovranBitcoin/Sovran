/**
 * @jest-environment node
 *
 * What a payment toast says in each phase, in the app's own copy: the title's
 * tense follows the payment, and a wait or an unknown outcome is never worded
 * as a failure.
 */

import { createPaymentCopyGroups } from 'wallet';

import { presentPaymentToast } from '@/shared/lib/popup/paymentToastPresentation';
import type {
  PaymentToastContent,
  PaymentToastVariant,
  PaymentToastView,
} from '@/shared/stores/runtime/paymentStatusStore';

jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn() }));

const copy = createPaymentCopyGroups().TOAST_COPY;

const payment = (
  variant: PaymentToastVariant,
  extra: Partial<Extract<PaymentToastContent, { kind: 'payment' }>> = {}
): PaymentToastContent => ({
  kind: 'payment',
  variant,
  mintUrl: 'https://mint.example',
  amount: 200,
  unit: 'sat',
  ...extra,
});

const present = (phase: PaymentToastView['phase'], content: PaymentToastContent) =>
  presentPaymentToast({ phase, content }, copy);

const VARIANTS: PaymentToastVariant[] = [
  'receive',
  'send',
  'melt',
  'receive-ecash',
  'payment-request',
];
const AMOUNT = { amount: 200, unit: 'sat' };

describe('presentPaymentToast', () => {
  it.each(VARIANTS)('never says a %s payment happened while it is still under way', (variant) => {
    const working = present('working', payment(variant));
    const done = present('done', payment(variant));
    expect(working.title).not.toBe(done.title);
    expect(working.title).toMatch(/^(Sending|Receiving) payment$/);
    expect(done.title).toMatch(/(sent|received)$/);
  });

  it('words each phase of a Lightning send', () => {
    expect(present('working', payment('melt'))).toEqual({
      status: 'pending',
      stage: 'processing',
      title: 'Sending payment',
      subtitle: 'Sending...',
    });
    expect(present('slow', payment('melt'))).toEqual({
      status: 'warning',
      stage: 'warning',
      title: 'Still in progress',
      subtitle: 'Taking longer than usual',
    });
    expect(present('done', payment('melt'))).toEqual({
      status: 'confirmed',
      stage: 'confirmed',
      title: 'Payment sent',
      subtitle: ['Sent ', AMOUNT],
    });
    expect(present('failed', payment('melt', { subtitle: 'No route' }))).toEqual({
      status: 'failed',
      stage: 'failed',
      title: 'Payment failed',
      subtitle: 'No route',
    });
  });

  it('says a delivered payment request is waiting on the recipient, then that it was claimed', () => {
    expect(present('handed-off', payment('payment-request'))).toEqual({
      status: 'delivered',
      stage: 'delivered',
      title: 'Payment request sent',
      subtitle: 'Waiting for recipient',
    });
    expect(present('done', payment('payment-request'))).toMatchObject({
      status: 'confirmed',
      subtitle: 'Claimed by recipient',
    });
  });

  it('words an unknown outcome as not confirmed yet: neither slow nor failed', () => {
    const shown = present('slow', payment('melt', { unconfirmed: true }));
    expect(shown).toEqual({
      status: 'warning',
      stage: 'warning',
      title: 'Not confirmed yet',
      subtitle: 'It may still complete. Check your history.',
    });
  });

  it('lets the caller say what a wait is for', () => {
    expect(
      present(
        'slow',
        payment('receive-ecash', { title: 'Ecash ready to redeem', subtitle: 'Later' })
      )
    ).toMatchObject({ status: 'warning', title: 'Ecash ready to redeem', subtitle: 'Later' });
  });

  it('shows a failure with no reason as just its title', () => {
    expect(present('failed', payment('receive'))).toEqual({
      status: 'failed',
      stage: 'failed',
      title: 'Payment failed',
    });
  });

  it('shows a payment in steps with the current step’s own wording', () => {
    expect(
      present('working', { kind: 'steps', title: 'Swapping', subtitle: 'a.example → b.example' })
    ).toEqual({
      status: 'pending',
      stage: 'processing',
      title: 'Swapping',
      subtitle: 'a.example → b.example',
    });
    expect(present('done', { kind: 'steps', title: 'Swap complete' })).toEqual({
      status: 'confirmed',
      stage: 'confirmed',
      title: 'Swap complete',
    });
  });
});
