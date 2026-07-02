import type { Manager } from '@cashu/coco-core';

import { cashuLog } from '@/shared/lib/logger';

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

type PreparedBolt11MintOperation = Awaited<ReturnType<Manager['ops']['mint']['prepare']>>;
type PreparedBolt11MeltOperation = Awaited<ReturnType<Manager['ops']['melt']['prepare']>>;

/**
 * v2 quote-first bolt11 mint: create the canonical quote row (remote quote
 * happens here), then prepare the durable operation against it.
 */
export async function prepareBolt11MintQuote(
  manager: Manager,
  mintUrl: string,
  amount: number,
  unit = 'sat'
): Promise<PreparedBolt11MintOperation> {
  cashuLog.info('coco.operations.mint.prepare.start', {
    ...mintUrlLogFields(mintUrl),
    amount,
    unit,
    method: 'bolt11',
  });
  try {
    const quote = await manager.quotes.mint.create({
      mintUrl,
      method: 'bolt11',
      amount: { amount, unit },
    });
    cashuLog.info('coco.operations.mint.quote_created', {
      ...mintUrlLogFields(mintUrl),
      quoteId: quote.quoteId,
      unit: quote.unit,
      method: 'bolt11',
    });
    const operation = await manager.ops.mint.prepare({ quote, amount });
    cashuLog.info('coco.operations.mint.prepare.done', {
      ...mintUrlLogFields(mintUrl),
      amount,
      method: 'bolt11',
    });
    return operation;
  } catch (error) {
    cashuLog.warn('coco.operations.mint.prepare.failed', {
      ...mintUrlLogFields(mintUrl),
      amount,
      method: 'bolt11',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

/**
 * v2 quote-first bolt11 melt: create the canonical melt quote row, then
 * prepare the durable operation (reserves proofs, computes fees) against it.
 */
export async function prepareBolt11MeltQuote(
  manager: Manager,
  mintUrl: string,
  invoice: string,
  unit = 'sat'
): Promise<PreparedBolt11MeltOperation> {
  cashuLog.info('coco.operations.melt.prepare.start', {
    ...mintUrlLogFields(mintUrl),
    method: 'bolt11',
    invoiceLength: invoice.length,
  });
  try {
    const quote = await manager.quotes.melt.create({
      mintUrl,
      method: 'bolt11',
      methodData: { invoice },
      unit,
    });
    cashuLog.info('coco.operations.melt.quote_created', {
      ...mintUrlLogFields(mintUrl),
      quoteId: quote.quoteId,
      method: 'bolt11',
    });
    const operation = await manager.ops.melt.prepare({ quote });
    cashuLog.info('coco.operations.melt.prepare.done', {
      ...mintUrlLogFields(mintUrl),
      method: 'bolt11',
      invoiceLength: invoice.length,
    });
    return operation;
  } catch (error) {
    cashuLog.warn('coco.operations.melt.prepare.failed', {
      ...mintUrlLogFields(mintUrl),
      method: 'bolt11',
      invoiceLength: invoice.length,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}
