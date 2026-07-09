// ---------------------------------------------------------------------------
// ExpiryCountdown — the "• expires in 14m 32s" badge next to the status header
// ---------------------------------------------------------------------------
//
// Self-contained: owns its OWN 1s interval, so the per-second countdown tick
// re-renders only this badge — it never rebuilds the timeline model or the
// rows (the card flips exactly once at the expiry boundary instead).

import { useEffect, useRef, useState } from 'react';

import { MintQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';

import type { HistoryEntry } from '@cashu/coco-core';

import { Text } from '@/shared/ui/primitives/Text';
import {
  meltQuoteExpired,
  getMeltQuoteTimeUntilExpiry,
  mintHistoryEntryExpired,
  getMintHistoryEntryTimeUntilExpiry,
} from '@/shared/lib/utils';
import { paymentLog } from '@/shared/lib/logger';

/** The badge text for the current instant, or null when no countdown applies:
 *  melt quotes count down to their quote expiry; Lightning mint invoices count
 *  down while still UNPAID (onchain deposit addresses never expire, so the
 *  Lightning expiry decode must not even run for them). */
export function getExpiryBadgeText(
  historyEntry: HistoryEntry,
  meltQuote: MeltQuoteBolt11Response | undefined,
  isOnchainMint: boolean,
  currentTime: number
): string | null {
  if (historyEntry.type === 'melt' && meltQuote && !meltQuoteExpired(meltQuote, currentTime)) {
    const expiryInfo = getMeltQuoteTimeUntilExpiry(meltQuote, currentTime);
    if (expiryInfo) return expiryInfo;
  }

  if (
    historyEntry.type === 'mint' &&
    !isOnchainMint &&
    String(historyEntry.state) === MintQuoteState.UNPAID &&
    !mintHistoryEntryExpired(historyEntry)
  ) {
    const expiryInfo = getMintHistoryEntryTimeUntilExpiry(historyEntry);
    if (expiryInfo) return expiryInfo;
  }

  return null;
}

interface ExpiryCountdownProps {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  isOnchainMint: boolean;
  /** Badge tint — the status header's resolved color. */
  color: string;
  /** Diagnostics context for the tx.history_timeline.* taxonomy. */
  entryId: string;
}

export function ExpiryCountdown({
  historyEntry,
  meltQuote,
  isOnchainMint,
  color,
  entryId,
}: ExpiryCountdownProps) {
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const meltExpiry = meltQuote?.expiry;
  const mintState = historyEntry.type === 'mint' ? historyEntry.state : null;

  useEffect(() => {
    const shouldUpdate =
      (historyEntry.type === 'melt' && meltExpiry) ||
      (historyEntry.type === 'mint' && !isOnchainMint && mintState === MintQuoteState.UNPAID);

    if (shouldUpdate) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [historyEntry.type, isOnchainMint, meltExpiry, mintState]);

  const expiryBadge = getExpiryBadgeText(historyEntry, meltQuote, isOnchainMint, currentTime);

  // Countdown badge: log appear/disappear (with the value at the flip), not
  // every one-second tick.
  const expiryBadgeVisible = expiryBadge != null;
  const prevBadgeVisibleRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevBadgeVisibleRef.current === expiryBadgeVisible) return;
    const firstRun = prevBadgeVisibleRef.current === null;
    prevBadgeVisibleRef.current = expiryBadgeVisible;
    paymentLog.debug('tx.history_timeline.expiry_badge', {
      entryId,
      visible: expiryBadgeVisible,
      valueAtFlip: expiryBadge,
      firstRun,
    });
  }, [expiryBadgeVisible, expiryBadge, entryId]);

  if (!expiryBadge) return null;

  return (
    <Text
      size={12}
      style={{
        color,
        marginLeft: 4,
      }}>
      •{'  '}
      {expiryBadge}
    </Text>
  );
}
