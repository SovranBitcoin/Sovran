/**
 * @fileoverview Scan History Store
 *
 * Keeps track of all QR codes/strings that have been scanned via QR or NFC.
 *
 * Used for:
 * - Recently scanned items
 * - Scan analytics
 * - Quick re-access to previously scanned data
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { mintLocalId } from '@/shared/lib/id';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

/** Cap matches `searchHistoryStore`'s MAX_RECENT_SEARCHES convention; tail-evicts oldest. */
const MAX_SCAN_HISTORY = 500;

/** What type of data was scanned */
type ScanType = 'npub' | 'ecash' | 'lightning' | 'mint' | 'paymentRequest' | 'unknown';

/** How the data was scanned/entered */
export type ScanSource = 'qr' | 'nfc' | 'paste' | 'deeplink';

export interface ScanHistoryEntry {
  /** Unique identifier for this scan */
  id: string;
  /** The raw string as scanned */
  raw: string;
  /** Type of the scanned data (what was scanned) */
  type: ScanType;
  /** Source of the scan (how it was scanned) */
  source: ScanSource;
  /** Structural input type from the parser (e.g., 'bip321', 'payment', 'mintUrl') */
  inputType?: string;
  /** Container format (e.g., 'bip321' when input was a bitcoin: URI) */
  container?: string;
  /** Payment option kinds available in the input (e.g., ['lightningInvoice', 'paymentRequest']) */
  optionKinds?: string[];
  /** Timestamp when scanned */
  scannedAt: number;
  /** ID of the transaction history entry this scan resulted in */
  transactionId?: string;
}

interface ScanHistoryState {
  entries: ScanHistoryEntry[];
  /**
   * Indexed view of `entries` keyed by `transactionId` so row + detail
   * selectors can resolve a scan in O(1) instead of scanning `entries`
   * once per mounted row. Maintained by `addScan`/`linkTransaction` and
   * rebuilt from `entries` after rehydration; not persisted. Direct
   * `setState({ entries })` (test-only) won't refresh it — call an action
   * or seed `entriesByTransactionId` alongside.
   */
  entriesByTransactionId: Record<string, ScanHistoryEntry>;
}

function buildEntriesByTransactionId(
  entries: ScanHistoryEntry[]
): Record<string, ScanHistoryEntry> {
  const byTx: Record<string, ScanHistoryEntry> = {};
  for (const entry of entries) {
    if (entry.transactionId) byTx[entry.transactionId] = entry;
  }
  return byTx;
}

interface ScanHistoryActions {
  /** Add a scan to history. Dedupes on the normalised raw (see `normaliseForDedupe`). */
  addScan: (
    raw: string,
    type: ScanType,
    source: ScanSource,
    inputType?: string,
    container?: string,
    optionKinds?: string[]
  ) => void;
  /** Link a scan entry to a transaction by matching the raw string. */
  linkTransaction: (raw: string, transactionId: string) => void;
}

type ScanHistoryStore = ScanHistoryState & ScanHistoryActions;

/**
 * Lookup key for dedupe — never persisted. Strips a leading payment-URI scheme
 * (`nostr:`, `cashu:`, `bitcoin:`, `lightning:`), trims, and lower-cases so
 * trivially-different surface forms collapse onto the same prior entry.
 */
export function normaliseForDedupe(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return trimmed.replace(/^(nostr|cashu|bitcoin|lightning):/, '');
}

// `processed` was an in-memory mirror of `raw` (the sole call site passed raw
// twice). Removed from the schema; older persisted blobs that still carry
// `processed` validate via `looseObject` and the value ages out via the cap.
const PersistedScanEntry = z.looseObject({
  id: z.string().max(128),
  raw: z.string().max(16_384),
  type: z.enum(['npub', 'ecash', 'lightning', 'mint', 'paymentRequest', 'unknown']),
  source: z.enum(['qr', 'nfc', 'paste', 'deeplink']),
  inputType: z.string().max(64).optional(),
  container: z.string().max(64).optional(),
  optionKinds: z.array(z.string().max(128)).max(64).optional(),
  scannedAt: z.number().int().nonnegative(),
  transactionId: z.string().max(256).optional(),
});

const PersistedScanHistoryStore = z.object({
  entries: z.array(PersistedScanEntry).max(MAX_SCAN_HISTORY).default([]),
});

export const useScanHistoryStore = create<ScanHistoryStore>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        entries: [],
        entriesByTransactionId: {},

        addScan: (
          raw: string,
          type: ScanType,
          source: ScanSource,
          inputType?: string,
          container?: string,
          optionKinds?: string[]
        ) => {
          storeLog.info('store.scan_history.add', { type, source, inputType, container });
          const now = Date.now();
          const key = normaliseForDedupe(raw);

          set((state) => {
            const existingIndex = state.entries.findIndex(
              (entry) => normaliseForDedupe(entry.raw) === key
            );
            let nextEntries: ScanHistoryEntry[];
            if (existingIndex !== -1) {
              nextEntries = [...state.entries];
              nextEntries[existingIndex] = {
                ...nextEntries[existingIndex],
                source,
                scannedAt: now,
                ...(inputType != null && { inputType }),
                ...(container != null && { container }),
                ...(optionKinds != null && { optionKinds }),
              };
            } else {
              const newEntry: ScanHistoryEntry = {
                id: mintLocalId('scan'),
                raw,
                type,
                source,
                ...(inputType != null && { inputType }),
                ...(container != null && { container }),
                ...(optionKinds != null && { optionKinds }),
                scannedAt: now,
              };
              const appended = [...state.entries, newEntry];
              // Tail-evict oldest by scannedAt once the cap is breached. Stable when under cap.
              nextEntries =
                appended.length > MAX_SCAN_HISTORY
                  ? [...appended]
                      .sort((a, b) => b.scannedAt - a.scannedAt)
                      .slice(0, MAX_SCAN_HISTORY)
                  : appended;
            }
            return {
              entries: nextEntries,
              entriesByTransactionId: buildEntriesByTransactionId(nextEntries),
            };
          });
        },

        linkTransaction: (raw: string, transactionId: string) => {
          if (!raw || !transactionId) return;
          storeLog.debug('store.scan_history.link_transaction', { transactionId });

          set((state) => {
            const index = state.entries.findIndex((entry) => entry.raw === raw);
            if (index === -1) return state;
            const nextEntries = [...state.entries];
            nextEntries[index] = { ...nextEntries[index], transactionId };
            return {
              entries: nextEntries,
              entriesByTransactionId: buildEntriesByTransactionId(nextEntries),
            };
          });
        },
      }),
      persistConfig({
        name: 'scan-history-store',
        storage: profileStorage,
        schema: PersistedScanHistoryStore,
        partialize: (state) => ({ entries: state.entries }),
        afterHydrate: (state) => {
          if (state) {
            state.entriesByTransactionId = buildEntriesByTransactionId(state.entries);
          }
        },
      })
    )
  )
);

/**
 * O(1) selector for the scan-history entry linked to a given transaction id.
 * Row + detail surfaces both consume this so they share one subscription
 * shape and skip the per-render `entries.find` scan that compounds with
 * scroll length × scan-history depth.
 */
export function useScanEntryForTransactionId(
  transactionId: string | undefined
): ScanHistoryEntry | null {
  return useScanHistoryStore((state) =>
    transactionId ? (state.entriesByTransactionId[transactionId] ?? null) : null
  );
}
