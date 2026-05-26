import type { HistoryEntry } from '@cashu/coco-core';

import { getOnchainMeltAddress } from '@/shared/lib/cashu/onchainMelt';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';

export type MintDetailPathname = '/lightningReceive' | '/onchainReceive';
export type MeltDetailPathname = '/lightningSend' | '/onchainSend';

export function getMintDetailPathname(entry: HistoryEntry): MintDetailPathname {
  return getOnchainMintAddress(entry) ? '/onchainReceive' : '/lightningReceive';
}

export function getMeltDetailPathname(entry: HistoryEntry): MeltDetailPathname {
  return getOnchainMeltAddress(entry) ? '/onchainSend' : '/lightningSend';
}
