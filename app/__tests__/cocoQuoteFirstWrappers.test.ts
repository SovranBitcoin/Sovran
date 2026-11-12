/**
 * @jest-environment node
 *
 * Characterization of the quote-first wrappers Colada uses for mint and melt
 * quotes: what each asks Coco for, in which order, with which amount, unit and
 * method, and what reaches the caller and the failure reporter when the quote
 * or the operation is refused. Coco is a recording fake.
 */

import type { Manager } from '@cashu/coco-core';

import { prepareBolt11MeltQuote, prepareMintQuote } from '@/shared/lib/cashu/cocoOperations';
import { reportCocoApiFailure } from '@/shared/lib/cashu/cocoFeedback';

jest.mock('@/shared/lib/cashu/cocoFeedback', () => ({ reportCocoApiFailure: jest.fn() }));

const MINT = 'https://mint.example';
const INVOICE = 'lnbc10n1pexample';

function fakeManager() {
  const calls: string[] = [];
  const mintQuote = { quoteId: 'mq-1', unit: 'sat' };
  const meltQuote = { quoteId: 'lq-1', unit: 'sat' };
  const mintOperation = { id: 'mint-op' };
  const meltOperation = { id: 'melt-op' };
  const manager = {
    quotes: {
      mint: {
        create: jest.fn(async (args: unknown) => {
          calls.push('quotes.mint.create');
          void args;
          return mintQuote;
        }),
      },
      melt: {
        create: jest.fn(async (args: unknown) => {
          calls.push('quotes.melt.create');
          void args;
          return meltQuote;
        }),
      },
    },
    ops: {
      mint: {
        prepare: jest.fn(async (args: unknown) => {
          calls.push('ops.mint.prepare');
          void args;
          return mintOperation;
        }),
      },
      melt: {
        prepare: jest.fn(async (args: unknown) => {
          calls.push('ops.melt.prepare');
          void args;
          return meltOperation;
        }),
      },
    },
  };
  return {
    manager,
    asManager: manager as unknown as Manager,
    calls,
    mintQuote,
    meltQuote,
    mintOperation,
    meltOperation,
  };
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.mocked(reportCocoApiFailure).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('prepareMintQuote for bolt11', () => {
  it('creates a bolt11 quote for the amount and unit, then prepares the operation against it', async () => {
    const coco = fakeManager();

    const result = await prepareMintQuote(coco.asManager, 'bolt11', MINT, 210, 'usd');

    expect(coco.calls).toEqual(['quotes.mint.create', 'ops.mint.prepare']);
    expect(coco.manager.quotes.mint.create).toHaveBeenCalledWith({
      mintUrl: MINT,
      method: 'bolt11',
      amount: { amount: 210, unit: 'usd' },
    });
    expect(coco.manager.ops.mint.prepare).toHaveBeenCalledWith({
      quote: coco.mintQuote,
      amount: 210,
    });
    expect(result).toBe(coco.mintOperation);
    expect(reportCocoApiFailure).not.toHaveBeenCalled();
  });

  it('defaults the unit to sat', async () => {
    const coco = fakeManager();

    await prepareMintQuote(coco.asManager, 'bolt11', MINT, 5);

    expect(coco.manager.quotes.mint.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { amount: 5, unit: 'sat' } })
    );
  });

  it('prepares nothing when the quote is refused, reports it and rethrows the same error', async () => {
    const coco = fakeManager();
    const refused = new Error('mint refused quote');
    coco.manager.quotes.mint.create.mockRejectedValueOnce(refused);

    await expect(prepareMintQuote(coco.asManager, 'bolt11', MINT, 21)).rejects.toBe(refused);

    expect(coco.manager.ops.mint.prepare).not.toHaveBeenCalled();
    expect(reportCocoApiFailure).toHaveBeenCalledWith(
      'quotes.mint.create/ops.mint.prepare',
      refused,
      { method: 'bolt11', unit: 'sat' }
    );
  });

  it('reports and rethrows when the operation is refused after the quote exists', async () => {
    const coco = fakeManager();
    const refused = new Error('prepare failed');
    coco.manager.ops.mint.prepare.mockRejectedValueOnce(refused);

    await expect(prepareMintQuote(coco.asManager, 'bolt11', MINT, 21)).rejects.toBe(refused);

    expect(coco.manager.ops.mint.prepare).toHaveBeenCalledWith({
      quote: coco.mintQuote,
      amount: 21,
    });
    expect(reportCocoApiFailure).toHaveBeenCalledWith(
      'quotes.mint.create/ops.mint.prepare',
      refused,
      { method: 'bolt11', unit: 'sat' }
    );
  });
});

describe('prepareMintQuote for onchain', () => {
  it('creates an onchain quote with no amount, then prepares the operation with the amount', async () => {
    const coco = fakeManager();

    const result = await prepareMintQuote(coco.asManager, 'onchain', MINT, 50_000);

    expect(coco.calls).toEqual(['quotes.mint.create', 'ops.mint.prepare']);
    expect(coco.manager.quotes.mint.create).toHaveBeenCalledWith({
      mintUrl: MINT,
      method: 'onchain',
      unit: 'sat',
    });
    expect(coco.manager.ops.mint.prepare).toHaveBeenCalledWith({
      quote: coco.mintQuote,
      amount: 50_000,
    });
    expect(result).toBe(coco.mintOperation);
  });

  it('reports a refused quote as onchain and prepares nothing', async () => {
    const coco = fakeManager();
    const refused = new Error('no onchain');
    coco.manager.quotes.mint.create.mockRejectedValueOnce(refused);

    await expect(prepareMintQuote(coco.asManager, 'onchain', MINT, 1, 'sat')).rejects.toBe(refused);

    expect(coco.manager.ops.mint.prepare).not.toHaveBeenCalled();
    expect(reportCocoApiFailure).toHaveBeenCalledWith(
      'quotes.mint.create/ops.mint.prepare',
      refused,
      { method: 'onchain', unit: 'sat' }
    );
  });
});

describe('prepareBolt11MeltQuote', () => {
  it('creates a melt quote for the invoice, then prepares the operation against it', async () => {
    const coco = fakeManager();

    const result = await prepareBolt11MeltQuote(coco.asManager, MINT, INVOICE, 'sat');

    expect(coco.calls).toEqual(['quotes.melt.create', 'ops.melt.prepare']);
    expect(coco.manager.quotes.melt.create).toHaveBeenCalledWith({
      mintUrl: MINT,
      method: 'bolt11',
      methodData: { invoice: INVOICE },
      unit: 'sat',
    });
    expect(coco.manager.ops.melt.prepare).toHaveBeenCalledWith({ quote: coco.meltQuote });
    expect(result).toBe(coco.meltOperation);
  });

  it('prepares nothing when the melt quote is refused, reports it and rethrows', async () => {
    const coco = fakeManager();
    const refused = new Error('invoice expired');
    coco.manager.quotes.melt.create.mockRejectedValueOnce(refused);

    await expect(prepareBolt11MeltQuote(coco.asManager, MINT, INVOICE, 'usd')).rejects.toBe(
      refused
    );

    expect(coco.manager.ops.melt.prepare).not.toHaveBeenCalled();
    expect(reportCocoApiFailure).toHaveBeenCalledWith(
      'quotes.melt.create/ops.melt.prepare',
      refused,
      { method: 'bolt11', unit: 'usd' }
    );
  });

  it('reports and rethrows when the melt operation is refused after the quote exists', async () => {
    const coco = fakeManager();
    const refused = new Error('insufficient balance');
    coco.manager.ops.melt.prepare.mockRejectedValueOnce(refused);

    await expect(prepareBolt11MeltQuote(coco.asManager, MINT, INVOICE)).rejects.toBe(refused);

    expect(coco.manager.ops.melt.prepare).toHaveBeenCalledWith({ quote: coco.meltQuote });
    expect(reportCocoApiFailure).toHaveBeenCalledWith(
      'quotes.melt.create/ops.melt.prepare',
      refused,
      { method: 'bolt11', unit: 'sat' }
    );
  });
});
