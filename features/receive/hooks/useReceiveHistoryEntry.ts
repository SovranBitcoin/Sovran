/**
 * @fileoverview Receive-specific history entry hook with live updates
 *
 * Handles the scan-placeholder → real-entry transition. Unlike useHistoryEntry
 * (which matches only by id), this also listens for receive entries that match
 * by amount+mintUrl when showing a scan placeholder. When coco creates the real
 * entry after redeem, history:updated fires with a different id — we match and
 * update so the UI reflects "Added to wallet" immediately.
 */

import { useState, useEffect, useMemo } from 'react';

import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

export type UseReceiveHistoryEntryResult = {
  /** Current entry (parsed or resolved real entry) */
  entry: ReceiveHistoryEntry | null;
  /** Parse error if initial data invalid */
  error: string | null;
  /** Real persisted entry id when resolved (for location lookup) */
  finalizedTransactionId: string | null;
};

function parseEntry(initial: ReceiveHistoryEntry | string | undefined): {
  parsed: ReceiveHistoryEntry | null;
  error: string | null;
} {
  if (!initial) {
    return { parsed: null, error: 'Missing transaction data. Please try again.' };
  }
  if (typeof initial === 'string') {
    try {
      return { parsed: JSON.parse(initial) as ReceiveHistoryEntry, error: null };
    } catch {
      return { parsed: null, error: 'Invalid transaction data. Please try again.' };
    }
  }
  return { parsed: initial, error: null };
}

function isScanPlaceholder(entry: ReceiveHistoryEntry | null): boolean {
  return (entry?.id?.startsWith('receive-') ?? false) as boolean;
}

export function useReceiveHistoryEntry(
  initialEntry: ReceiveHistoryEntry | string | undefined
): UseReceiveHistoryEntryResult {
  const manager = useManager();
  const { parsed, error: parseError } = useMemo(() => parseEntry(initialEntry), [initialEntry]);

  const [entry, setEntry] = useState<ReceiveHistoryEntry | null>(parsed);
  const [finalizedTransactionId, setFinalizedTransactionId] = useState<string | null>(
    parsed && !isScanPlaceholder(parsed) ? parsed.id : null
  );

  const tokenString = entry?.token ? manager.wallet.encodeToken(entry.token) : undefined;

  // Sync when parsed changes (e.g. navigation params)
  useEffect(() => {
    if (parsed) {
      setEntry(parsed);
      if (!isScanPlaceholder(parsed)) {
        setFinalizedTransactionId(parsed.id);
      }
    }
  }, [parsed]);

  // Subscribe to history:updated — match by id (persisted) or amount+mintUrl (scan placeholder)
  useEffect(() => {
    if (!parsed || !manager) return;

    const parsedIsPlaceholder = isScanPlaceholder(parsed);

    const handleHistoryUpdated = ({
      entry: updated,
    }: {
      mintUrl: string;
      entry: import('coco-cashu-core').HistoryEntry;
    }) => {
      if (updated.type !== 'receive') return;

      const receiveEntry = updated as ReceiveHistoryEntry;

      if (parsed.id === receiveEntry.id) {
        setEntry(receiveEntry);
        setFinalizedTransactionId(receiveEntry.id);
        return;
      }

      if (
        parsedIsPlaceholder &&
        parsed.amount !== undefined &&
        parsed.mintUrl &&
        receiveEntry.amount === parsed.amount &&
        receiveEntry.mintUrl === parsed.mintUrl
      ) {
        setEntry(receiveEntry);
        setFinalizedTransactionId(receiveEntry.id);
      }
    };

    const unsubscribe = manager.on('history:updated', handleHistoryUpdated);
    return () => unsubscribe();
  }, [parsed, manager]);

  // Resolve existing redeem on mount (token already in history from prior session)
  useEffect(() => {
    if (!parsed || !isScanPlaceholder(parsed) || !tokenString || !manager) return;

    let cancelled = false;

    const resolve = async () => {
      try {
        const recent = await manager.history.getPaginatedHistory(0, 200);
        const match = recent.find((e) => {
          if (e.type !== 'receive' || !e.token) return false;
          try {
            return manager.wallet.encodeToken(e.token) === tokenString;
          } catch {
            return false;
          }
        });

        if (!match?.id || cancelled) return;

        const rawToken = (parsed.metadata as { rawToken?: string })?.rawToken;
        if (rawToken || tokenString) {
          useScanHistoryStore.getState().linkTransaction(rawToken || tokenString, match.id);
        }

        setEntry(match as ReceiveHistoryEntry);
        setFinalizedTransactionId(match.id);
      } catch (err) {
        console.error('[useReceiveHistoryEntry] resolve failed:', err);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [parsed, tokenString, manager]);

  return {
    entry,
    error: parseError,
    finalizedTransactionId,
  };
}
