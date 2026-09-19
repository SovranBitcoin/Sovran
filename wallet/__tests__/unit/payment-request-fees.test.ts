import type { Manager } from '@cashu/coco-core';
import { describe, expect, it } from 'vitest';

import {
  assertPaymentRequestFeesSupported,
  PaymentRequestFeesUnsupportedError,
} from '../../src/core/paymentRequestFees';

const MINT = 'https://mint.example.com';

function managerWithKeysets(
  getKeysetsByMintUrl: () => Promise<{ unit?: string; feePpk: number }[]>,
): Manager {
  return {
    mintService: { keysetRepo: { getKeysetsByMintUrl } },
  } as unknown as Manager;
}

describe('assertPaymentRequestFeesSupported', () => {
  it('passes for a fee-free keyset in the unit', async () => {
    await expect(
      assertPaymentRequestFeesSupported(
        managerWithKeysets(async () => [{ unit: 'sat', feePpk: 0 }]),
        MINT,
        'sat',
      ),
    ).resolves.toBeUndefined();
  });

  it('keeps the keyset-load failure as the cause', async () => {
    const cause = new Error('db closed');
    const error = await assertPaymentRequestFeesSupported(
      managerWithKeysets(async () => {
        throw cause;
      }),
      MINT,
      'sat',
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PaymentRequestFeesUnsupportedError);
    expect(error).toMatchObject({ code: 'keysets-unavailable', mintUrl: MINT, cause });
  });

  it('rejects a mint that charges redemption fees', async () => {
    await expect(
      assertPaymentRequestFeesSupported(
        managerWithKeysets(async () => [{ unit: 'sat', feePpk: 100 }]),
        MINT,
        'sat',
      ),
    ).rejects.toMatchObject({ code: 'redemption-fees', unit: 'sat' });
  });
});
