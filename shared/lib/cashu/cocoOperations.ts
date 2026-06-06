import type { Manager } from '@cashu/coco-core';

type PreparedBolt11MintOperation = Awaited<ReturnType<Manager['ops']['mint']['prepare']>>;
type PreparedBolt11MeltOperation = Awaited<ReturnType<Manager['ops']['melt']['prepare']>>;

function requireSatUnit(unit?: string): 'sat' {
  if (unit != null && unit !== 'sat') {
    throw new Error(`@cashu/coco-core 1.0.1 only supports sat-denominated operations`);
  }
  return 'sat';
}

export function prepareBolt11MintQuote(
  manager: Manager,
  mintUrl: string,
  amount: number,
  unit?: string
): Promise<PreparedBolt11MintOperation> {
  return manager.ops.mint.prepare({
    mintUrl,
    amount,
    unit: requireSatUnit(unit),
    method: 'bolt11',
    methodData: {},
  });
}

export function prepareBolt11MeltQuote(
  manager: Manager,
  mintUrl: string,
  invoice: string
): Promise<PreparedBolt11MeltOperation> {
  return manager.ops.melt.prepare({
    mintUrl,
    method: 'bolt11',
    methodData: { invoice },
  });
}
