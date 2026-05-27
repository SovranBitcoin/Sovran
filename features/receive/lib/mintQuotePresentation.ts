import type { HistoryEntry } from '@cashu/coco-core';

import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import type { MempoolAddressSummary } from '@/shared/lib/bitcoin/mempool';
import {
  getOnchainConfirmationProgress,
  type OnchainConfirmationProgress,
} from '@/shared/lib/bitcoin/onchainPaymentStatus';

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
