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

import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { mintLocalId } from '@/shared/lib/id';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

/** Cap matches `searchHistoryStore`'s MAX_RECENT_SEARCHES convention; tail-evicts oldest. */
const MAX_SCAN_HISTORY = 500;

/** Longest scanned string that is kept. A longer one is not recorded. */
const MAX_SCAN_RAW_LENGTH = 16_384;

/** The newest `MAX_SCAN_HISTORY` entries. The same array when it already fits. */
function newestScans<T extends { scannedAt: number }>(entries: T[]): T[] {
  return entries.length > MAX_SCAN_HISTORY
    ? [...entries].sort((a, b) => b.scannedAt - a.scannedAt).slice(0, MAX_SCAN_HISTORY)
    : entries;
}

/** What type of data was scanned */
type ScanType = 'npub' | 'ecash' | 'lightning' | 'mint' | 'paymentRequest' | 'unknown';

/** How the data was scanned/entered */
export type ScanSource = 'qr' | 'nfc' | 'paste' | 'deeplink';

interface ScanHistoryEntry {
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
  addScan: (scan: {
    raw: string;
    type: ScanType;
    source: ScanSource;
    inputType?: string;
    container?: string;
    optionKinds?: string[];
  }) => void;
  /** Link a scan entry to a transaction by matching the raw string. */
  linkTransaction: (raw: string, transactionId: string) => void;
}

type ScanHistoryStore = ScanHistoryState & ScanHistoryActions;

/** Compare URI wrappers without folding case-sensitive Cashu/base64 or URL payloads. */
function normaliseForDedupe(raw: string): string {
  const value = raw.trim().replace(/^(nostr|cashu|bitcoin|lightning):/i, '');
  // BOLT-11 / Bech32 and hexadecimal identities are case-insensitive. URI
  // queries and other payloads are not; never lowercase an arbitrary scan.
  return /^(?:ln(?:bc|tb|bcrt)[0-9]*[munp]?1|(?:lnurl|npub|nprofile|note|nevent|naddr|nsec|bc|tb|bcrt)1)[a-z0-9]+$/i.test(
    value
  ) || /^[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : value;
}

// `processed` was an in-memory mirror of `raw` (the sole call site passed raw
// twice). Removed from the schema; older persisted blobs that still carry
// `processed` validate via `looseObject` and the value ages out via the cap.
const PersistedScanEntry = z.looseObject({
  id: z.string().max(128),
  // No length limit on reading: earlier releases saved any length.
  raw: z.string(),
  // `.catch(...)`: display metadata — an unrecognized value must not fail the
  // parse and discard the whole scan-history blob. Unknown types render as
  // 'unknown'; an unknown source falls back to the plain qr icon.
  type: z
    .enum(['npub', 'ecash', 'lightning', 'mint', 'paymentRequest', 'unknown'])
    .catch('unknown'),
  source: z.enum(['qr', 'nfc', 'paste', 'deeplink']).catch('qr'),
  inputType: z.string().max(64).optional(),
  container: z.string().max(64).optional(),
  optionKinds: z.array(z.string().max(128)).max(64).optional(),
  scannedAt: z.number().int().nonnegative(),
  transactionId: z.string().max(256).optional(),
});

// Releases before 0.1.3 saved every scan, of any length, and a schema that
// turns the list down empties the whole history. So reading accepts everything
// an earlier release wrote and trims nothing: an old scan may carry the only
// link to its transaction, which the annotation import still has to read. The
// limits are kept by `addScan`, which brings the list back under them the next
// time a scan is added. An entry that is not a scan at all costs that entry
// alone. The entry schema stays inside the array so the drift snapshot still
// records its shape.
const PersistedScanHistoryStore = z.object({
  entries: z
    .array(PersistedScanEntry.optional().catch(undefined))
    .transform((entries) => entries.filter((entry) => entry !== undefined))
    .default([]),
});

export const useScanHistoryStore = create<ScanHistoryStore>({
  name: 'scan-history-store',
  scope: 'profile',
})(
  subscribeWithSelector(
    persist(
      (set) => ({
        entries: [],
        entriesByTransactionId: {},

        addScan: ({ raw, type, source, inputType, container, optionKinds }) => {
          // Too long to be worth keeping; a history of these fills storage.
          if (raw.length > MAX_SCAN_RAW_LENGTH) return;
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
              // Tail-evict oldest by scannedAt once the cap is breached. Stable when under cap.
              nextEntries = newestScans([...state.entries, newEntry]);
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
            const key = normaliseForDedupe(raw);
            const index = state.entries.findIndex((entry) => normaliseForDedupe(entry.raw) === key);
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

// Per-transaction scan lookup moved to colada annotations
// (useColadaTransactionAnnotation); this store now backs only the recents list
// and the transaction-link bookkeeping consumed by the one-time migration.
