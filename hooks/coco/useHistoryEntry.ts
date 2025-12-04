import { useState, useEffect, useMemo } from 'react';
import type { HistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

export type UseHistoryEntryResult<T extends HistoryEntry> = {
  /** The current history entry (updated via events) */
  entry: T | null;
  /** Parse error message if initial entry was invalid */
  error: string | null;
};

/**
 * Hook to manage a single history entry with real-time updates.
 *
 * Handles:
 * - Parsing string input (JSON) to HistoryEntry
 * - Maintaining current entry state
 * - Subscribing to `history:updated` events for real-time sync
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
  const manager = useManager();

  // Parse initialEntry - handles both string (from route params) and object
  const { parsed, parseError } = useMemo(() => {
    if (!initialEntry) {
      return {
        parsed: null,
        parseError: 'Missing transaction data. Please try again.',
      };
    }

    if (typeof initialEntry === 'string') {
      try {
        return {
          parsed: JSON.parse(initialEntry) as T,
          parseError: null,
        };
      } catch {
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

  // Subscribe to history:updated events to keep entry in sync
  useEffect(() => {
    if (!parsed?.id) return;

    const handleHistoryUpdated = ({ entry }: { mintUrl: string; entry: HistoryEntry }) => {
      // Match by id and type for type safety
      if (entry.id === parsed.id && entry.type === parsed.type) {
        setCurrentEntry(entry as T);
      }
    };

    const unsubscribe = manager.on('history:updated', handleHistoryUpdated);

    return () => {
      unsubscribe();
    };
  }, [parsed?.id, parsed?.type, manager]);

  return {
    entry: currentEntry,
    error: parseError,
  };
}
