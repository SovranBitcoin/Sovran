import type { Manager } from '@cashu/coco-core';

import { cashuLog } from '@/shared/lib/logger';
import { mintUrlLogFields } from '@/shared/lib/mintUrlLog';

type PreparedBolt11MintOperation = Awaited<ReturnType<Manager['ops']['mint']['prepare']>>;
type PreparedBolt11MeltOperation = Awaited<ReturnType<Manager['ops']['melt']['prepare']>>;

function requireSatUnit(unit?: string): 'sat' {
  if (unit != null && unit !== 'sat') {
    cashuLog.warn('coco.operations.unit.unsupported', { unit });
    throw new Error(`@cashu/coco-core 1.0.1 only supports sat-denominated operations`);
  }
  cashuLog.debug('coco.operations.unit.ok', { unit: unit ?? 'sat' });
  return 'sat';
}

export async function prepareBolt11MintQuote(
  manager: Manager,
  mintUrl: string,
  amount: number,
  unit?: string
): Promise<PreparedBolt11MintOperation> {
  cashuLog.info('coco.operations.mint.prepare.start', {
    ...mintUrlLogFields(mintUrl),
    amount,
    unit: unit ?? 'sat',
    method: 'bolt11',
  });
  try {
    const operation = await manager.ops.mint.prepare({
      mintUrl,
      amount,
      unit: requireSatUnit(unit),
      method: 'bolt11',
      methodData: {},
    });
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

export async function prepareBolt11MeltQuote(
  manager: Manager,
  mintUrl: string,
  invoice: string
): Promise<PreparedBolt11MeltOperation> {
  cashuLog.info('coco.operations.melt.prepare.start', {
    ...mintUrlLogFields(mintUrl),
    method: 'bolt11',
    invoiceLength: invoice.length,
  });
  try {
    const operation = await manager.ops.melt.prepare({
      mintUrl,
      method: 'bolt11',
      methodData: { invoice },
    });
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
