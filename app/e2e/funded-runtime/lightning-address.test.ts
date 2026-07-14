import { describe, expect, it } from 'bun:test';

import { resolveLightningAddressInvoice } from './lightning-address';

describe('funded Lightning-address resolution', () => {
  it('delegates the exact address and sat amount to the wallet resolver', async () => {
    const calls: { address: string; amountSats: number }[] = [];
    const invoice = await resolveLightningAddressInvoice(
      'cocod@npubx.cash',
      21,
      async (address, amountSats) => {
        calls.push({ address, amountSats });
        return 'lnbc1fundedtestinvoice';
      }
    );

    expect(calls).toEqual([{ address: 'cocod@npubx.cash', amountSats: 21 }]);
    expect(invoice).toBe('lnbc1fundedtestinvoice');
  });

  it('rejects invalid addresses before touching the wallet resolver', async () => {
    let called = false;

    await expect(
      resolveLightningAddressInvoice('not-a-lightning-address', 21, async () => {
        called = true;
        return 'lnbc1fundedtestinvoice';
      })
    ).rejects.toThrow('invalid Lightning address');
    expect(called).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects non-exact sat amount %p before resolution',
    async (amountSats) => {
      let called = false;

      await expect(
        resolveLightningAddressInvoice('cocod@npubx.cash', amountSats, async () => {
          called = true;
          return 'lnbc1fundedtestinvoice';
        })
      ).rejects.toThrow('positive integer number of sats');
      expect(called).toBe(false);
    }
  );

  it.each(['', 'not-an-invoice', ' lnbc1fundedtestinvoice'])(
    'rejects invalid wallet resolver output %p',
    async (invoice) => {
      await expect(
        resolveLightningAddressInvoice('cocod@npubx.cash', 21, async () => invoice)
      ).rejects.toThrow('invalid BOLT11 invoice');
    }
  );

  it('bounds a resolver that never settles', async () => {
    await expect(
      resolveLightningAddressInvoice('cocod@npubx.cash', 21, () => new Promise<string>(() => {}), 1)
    ).rejects.toThrow(/timed out/);
  });
});
