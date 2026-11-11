import type { Manager } from '@cashu/coco-core';

import { cashuLog, mintUrlLogFields } from '@/shared/lib/logger';
import { reportCocoApiFailure } from './cocoFeedback';

type PreparedBolt11MintOperation = Awaited<ReturnType<Manager['ops']['mint']['prepare']>>;
type PreparedBolt11MeltOperation = Awaited<ReturnType<Manager['ops']['melt']['prepare']>>;

/**
 * v2 quote-first mint: create the canonical quote row (the remote quote
 * happens here), then prepare the durable operation against it with the
 * amount. A bolt11 quote carries the amount; an onchain quote is a reusable
 * one with a FRESH deposit address per call (payment attribution for
 * fixed-amount receives), so v2 takes the amount only at prepare.
 */
export async function prepareMintQuote(
  manager: Manager,
  method: 'bolt11' | 'onchain',
  mintUrl: string,
  amount: number,
  unit = 'sat'
): Promise<PreparedBolt11MintOperation> {
  cashuLog.info('coco.operations.mint.prepare.start', {
    ...mintUrlLogFields(mintUrl),
    amount,
    unit,
    method,
  });
  try {
    const quote = await manager.quotes.mint.create(
      method === 'bolt11'
        ? { mintUrl, method, amount: { amount, unit } }
        : { mintUrl, method, unit }
    );
    cashuLog.info('coco.operations.mint.quote_created', {
      ...mintUrlLogFields(mintUrl),
      quoteId: quote.quoteId,
      unit: quote.unit,
      method,
    });
    const operation = await manager.ops.mint.prepare({ quote, amount });
    cashuLog.info('coco.operations.mint.prepare.done', {
      ...mintUrlLogFields(mintUrl),
      amount,
      method,
    });
    return operation;
  } catch (error) {
    cashuLog.warn('coco.operations.mint.prepare.failed', {
      ...mintUrlLogFields(mintUrl),
      amount,
      method,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    reportCocoApiFailure('quotes.mint.create/ops.mint.prepare', error, { method, unit });
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
    reportCocoApiFailure('quotes.melt.create/ops.melt.prepare', error, {
      method: 'bolt11',
      unit,
    });
    throw error;
  }
}
