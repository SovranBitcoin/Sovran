import type { HistoryEntry } from '@cashu/coco-core';
import {
  getOnchainConfirmationProgress,
  type MempoolAddressSummary,
  type ChainOnchainConfirmationProgress as OnchainConfirmationProgress,
} from '@sovranbitcoin/colada';

import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';

export function getReceiveQuoteScreenTitle(isOnchainQuote: boolean): string {
  return isOnchainQuote ? 'Receive Onchain' : 'Receive Lightning';
}

export function isOnchainMintQuoteParam(mintHistoryEntry: string | null | undefined): boolean {
  if (!mintHistoryEntry) return false;

  try {
    return !!getOnchainMintAddress(JSON.parse(mintHistoryEntry) as HistoryEntry);
  } catch {
    return false;
  }
}

export function getMintQuoteRouteTitle(mintHistoryEntry: string | null | undefined): string {
  return getReceiveQuoteScreenTitle(isOnchainMintQuoteParam(mintHistoryEntry));
}

export function getOnchainStatusProgress(
  summary: MempoolAddressSummary | null | undefined,
  requiredConfirmations?: number
): OnchainConfirmationProgress | null {
  return getOnchainConfirmationProgress(summary, requiredConfirmations);
}
