import type { HistoryEntry } from '@cashu/coco-core';
import {
  getOnchainConfirmationProgress,
  type MempoolAddressSummary,
  type ChainOnchainConfirmationProgress as OnchainConfirmationProgress,
} from 'wallet';

import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { cashuLog } from '@/shared/lib/logger';

export function getReceiveQuoteScreenTitle(isOnchainQuote: boolean): string {
  const title = isOnchainQuote ? 'Receive Onchain' : 'Receive Lightning';
  cashuLog.debug('receive.mint_quote.title.result', {
    isOnchainQuote,
    title,
  });
  return title;
}

export function isOnchainMintQuoteParam(mintHistoryEntry: string | null | undefined): boolean {
  if (!mintHistoryEntry) {
    cashuLog.debug('receive.mint_quote.param.onchain.result', {
      reason: 'missing-param',
      paramLength: 0,
      isOnchain: false,
    });
    return false;
  }

  try {
    const isOnchain = !!getOnchainMintAddress(JSON.parse(mintHistoryEntry) as HistoryEntry);
    cashuLog.debug('receive.mint_quote.param.onchain.result', {
      reason: isOnchain ? 'onchain' : 'not-onchain',
      paramLength: mintHistoryEntry.length,
      isOnchain,
    });
    return isOnchain;
  } catch {
    cashuLog.warn('receive.mint_quote.param.parse_failed', {
      paramLength: mintHistoryEntry.length,
    });
    return false;
  }
}

export function getMintQuoteRouteTitle(mintHistoryEntry: string | null | undefined): string {
  const isOnchain = isOnchainMintQuoteParam(mintHistoryEntry);
  const title = getReceiveQuoteScreenTitle(isOnchain);
  cashuLog.debug('receive.mint_quote.route_title.result', {
    isOnchain,
    hasParam: !!mintHistoryEntry,
    title,
  });
  return title;
}

export function getOnchainStatusProgress(
  summary: MempoolAddressSummary | null | undefined,
  requiredConfirmations?: number
): OnchainConfirmationProgress | null {
  const progress = getOnchainConfirmationProgress(summary, requiredConfirmations);
  cashuLog.debug('receive.mint_quote.onchain_progress.result', {
    hasSummary: !!summary,
    requiredConfirmations: requiredConfirmations ?? null,
    hasProgress: !!progress,
    isSatisfied: progress?.isSatisfied ?? null,
    currentConfirmations: progress?.currentConfirmations ?? null,
  });
  return progress;
}
