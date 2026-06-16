import type { HistoryEntry } from '@cashu/coco-core';

import { getOnchainMeltAddress } from '@/shared/lib/cashu/onchainMelt';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { cashuLog } from '@/shared/lib/logger';

type MintDetailPathname = '/lightningReceive' | '/onchainReceive';
type MeltDetailPathname = '/lightningSend' | '/onchainSend';

export function getMintDetailPathname(entry: HistoryEntry): MintDetailPathname {
  const isOnchain = !!getOnchainMintAddress(entry);
  const pathname = isOnchain ? '/onchainReceive' : '/lightningReceive';
  cashuLog.debug('transactions.detail_route.mint', {
    type: entry.type,
    state:
      typeof (entry as Record<string, unknown>).state === 'string'
        ? (entry as Record<string, unknown>).state
        : null,
    isOnchain,
    pathname,
  });
  return pathname;
}

export function getMeltDetailPathname(entry: HistoryEntry): MeltDetailPathname {
  const isOnchain = !!getOnchainMeltAddress(entry);
  const pathname = isOnchain ? '/onchainSend' : '/lightningSend';
  cashuLog.debug('transactions.detail_route.melt', {
    type: entry.type,
    state:
      typeof (entry as Record<string, unknown>).state === 'string'
        ? (entry as Record<string, unknown>).state
        : null,
    isOnchain,
    pathname,
  });
  return pathname;
}
