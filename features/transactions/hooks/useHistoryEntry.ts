import { useState, useEffect, useMemo } from 'react';
import type { HistoryEntry } from '@cashu/coco-core';
import { useColadaSubscriptions } from '@sovranbitcoin/colada/react';
import { log } from '@/shared/lib/logger';

type UseHistoryEntryResult<T extends HistoryEntry> = {
  /** The current history entry (updated via events) */
  entry: T | null;
  /** Parse error message if initial entry was invalid */
  error: string | null;
};

function getStringField(entry: unknown, key: string): string | undefined {
  const value = (entry as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Hook to manage a single history entry with real-time updates.
 *
 * Handles:
 * - Parsing string input (JSON) to HistoryEntry
 * - Maintaining current entry state
 * - Subscribing to Colada's bus for real-time sync
 * - Syncing state when initialEntry prop changes
 *
 * @example
 * ```tsx
 * const { entry, error } = useHistoryEntry<SendHistoryEntry>(sendHistoryEntryProp);
 *
 * if (error) return <ErrorState message={error} />;
 * if (!entry) return <LoadingState />;
 *
 * return <TransactionDetails entry={entry} />;
 * ```
 */
export function useHistoryEntry<T extends HistoryEntry>(
  initialEntry: T | string | undefined
): UseHistoryEntryResult<T> {
  const bus = useColadaSubscriptions();

  // Parse initialEntry - handles both string (from route params) and object
  const { parsed, parseError } = useMemo(() => {
    if (!initialEntry) {
      log.warn('tx.history_entry.missing');
      return {
        parsed: null,
        parseError: 'Missing transaction data. Please try again.',
      };
    }

    if (typeof initialEntry === 'string') {
      try {
        const result = JSON.parse(initialEntry) as T;
        log.debug('tx.history_entry.parsed', { id: result.id, type: result.type });
        return {
          parsed: result,
          parseError: null,
        };
      } catch {
        log.error('tx.history_entry.parse_error');
        return {
          parsed: null,
          parseError: 'Invalid transaction data. Please try again.',
        };
      }
    }

    return { parsed: initialEntry, parseError: null };
  }, [initialEntry]);

  // Current entry state - starts with parsed value and updates via events
  const [currentEntry, setCurrentEntry] = useState<T | null>(parsed);

  // Sync currentEntry when parsed value changes (e.g., navigation params change)
  useEffect(() => {
    if (parsed) {
      setCurrentEntry(parsed);
    }
  }, [parsed]);

  // Subscribe through Colada's bus so detail screens share one update model
  // instead of attaching their own Coco manager watchers.
  useEffect(() => {
    if (!parsed?.id) return;

    const matchesParsedEntry = (entry: Record<string, unknown>): boolean => {
      if (entry.id === parsed.id && entry.type === parsed.type) return true;
      const parsedQuoteId = getStringField(parsed, 'quoteId');
      if (parsedQuoteId && entry.quoteId === parsedQuoteId) {
        return true;
      }
      if (
        typeof parsed.operationId === 'string' &&
        parsed.operationId.length > 0 &&
        entry.operationId === parsed.operationId
      ) {
        return true;
      }
      return false;
    };

    const unHistory = bus.subscribe(
      { type: 'history.updated', historyType: parsed.type, entryId: parsed.id },
      (event) => {
        log.debug('tx.history_entry.updated', { id: event.entryId, type: event.historyType });
        setCurrentEntry(event.entry as unknown as T);
      }
    );

    const operationType =
      parsed.type === 'melt' ? 'melt.updated' : parsed.type === 'mint' ? 'mint.updated' : null;
    const unOperation = operationType
      ? bus.subscribe({ type: operationType }, (event) => {
          if (!matchesParsedEntry(event.entry as Record<string, unknown>)) return;
          log.debug('tx.history_entry.operation_updated', {
            id: parsed.id,
            type: parsed.type,
            operationId: event.operationId,
            quoteId: event.quoteId,
          });
          setCurrentEntry((current) => Object.assign({}, current ?? parsed, event.entry) as T);
        })
      : undefined;

    return () => {
      unHistory();
      unOperation?.();
    };
  }, [parsed, bus]);

  return {
    entry: currentEntry,
    error: parseError,
  };
}
