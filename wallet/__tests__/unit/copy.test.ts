import { describe, expect, it } from 'vitest';

import {
  createPaymentCopyGroups,
  createPaymentCopyResolver,
  getPaymentCopy,
  resolvePaymentCopy,
} from '../../src/copy';

describe('payment copy', () => {
  it('resolves default English copy and interpolates variables', () => {
    expect(getPaymentCopy('timeline.mint.unpaid.label')).toBe('Waiting for payment');
    expect(getPaymentCopy('timeline.mint.issued.info', { amount: 21 })).toBe(
      '+21 sats added to wallet',
    );
  });

  it('returns typed errors for missing interpolation variables', () => {
    const result = resolvePaymentCopy('timeline.receive.redeemed.info');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      type: 'missing-variable',
      key: 'timeline.receive.redeemed.info',
      variable: 'amount',
    });
  });

  it('supports per-call overrides', () => {
    const copy = createPaymentCopyResolver({
      overrides: {
        'timeline.status.complete': 'Done',
      },
    });

    expect(copy.text('timeline.status.complete')).toBe('Done');
  });

  it('supports empty string overrides', () => {
    const copy = createPaymentCopyResolver({
      overrides: {
        'toast.send.failed': '',
      },
    });

    expect(copy.text('toast.send.failed')).toBe('');
  });

  it('builds grouped copy from a resolver', () => {
    const copy = createPaymentCopyResolver({
      overrides: {
        'timeline.mint.unpaid.label': 'Awaiting funds',
      },
    });

    expect(createPaymentCopyGroups(copy).MINT_COPY.UNPAID.label).toBe('Awaiting funds');
  });

});
