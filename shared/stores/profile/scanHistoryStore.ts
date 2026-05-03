/**
 * @fileoverview Scan History Store
 *
 * Keeps track of all QR codes/strings that have been scanned via QR or NFC.
 * Stores both raw and processed versions for different use cases.
 *
 * This can be used for:
 * - Recently scanned items
 * - Scan analytics
 * - Quick re-access to previously scanned data
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

const profileStorage = createProfileScopedStorage();

/** What type of data was scanned */
type ScanType = 'npub' | 'ecash' | 'lightning' | 'mint' | 'paymentRequest' | 'unknown';

/** How the data was scanned/entered */
export type ScanSource = 'qr' | 'nfc' | 'paste' | 'deeplink';

interface ScanHistoryEntry {
  /** Unique identifier for this scan */
  id: string;
  /** The raw string as scanned */
  raw: string;
  /** The processed/normalized string (e.g., npub without nostr: prefix) */
  processed: string;
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
}

interface ScanHistoryActions {
  /** Add a scan to history */
  addScan: (
    raw: string,
    processed: string,
    type: ScanType,
    source: ScanSource,
    inputType?: string,
    container?: string,
    optionKinds?: string[]
  ) => void;
  /** Link a scan entry to a transaction by matching the processed string */
  linkTransaction: (processed: string, transactionId: string) => void;
}

type ScanHistoryStore = ScanHistoryState & ScanHistoryActions;

const PersistedScanEntry = z.looseObject({
  id: z.string().max(128),
  raw: z.string().max(16_384),
  processed: z.string().max(16_384),
  type: z.enum(['npub', 'ecash', 'lightning', 'mint', 'paymentRequest', 'unknown']),
  source: z.enum(['qr', 'nfc', 'paste', 'deeplink']),
  inputType: z.string().max(64).optional(),
  container: z.string().max(64).optional(),
  optionKinds: z.array(z.string().max(128)).max(64).optional(),
  scannedAt: z.number().int().nonnegative(),
  transactionId: z.string().max(256).optional(),
});

const PersistedScanHistoryStore = z.object({
  entries: z.array(PersistedScanEntry).max(10_000).default([]),
});

const generateId = () => `scan-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const useScanHistoryStore = create<ScanHistoryStore>()(
  persist(
    (set) => ({
      entries: [],

      addScan: (
        raw: string,
        processed: string,
        type: ScanType,
        source: ScanSource,
        inputType?: string,
        container?: string,
        optionKinds?: string[]
      ) => {
        storeLog.info('store.scan_history.add', { type, source, inputType, container });
        const now = Date.now();

        set((state) => {
          const existingIndex = state.entries.findIndex((entry) => entry.raw === raw);
          if (existingIndex !== -1) {
            const updated = [...state.entries];
            updated[existingIndex] = {
              ...updated[existingIndex],
              source,
              scannedAt: now,
              ...(inputType != null && { inputType }),
              ...(container != null && { container }),
              ...(optionKinds != null && { optionKinds }),
            };
            return { entries: updated };
          }
          const newEntry: ScanHistoryEntry = {
            id: generateId(),
            raw,
            processed,
            type,
            source,
            ...(inputType != null && { inputType }),
            ...(container != null && { container }),
            ...(optionKinds != null && { optionKinds }),
            scannedAt: now,
          };
          return { entries: [...state.entries, newEntry] };
        });
      },

      linkTransaction: (processed: string, transactionId: string) => {
        if (!processed || !transactionId) return;
        storeLog.debug('store.scan_history.link_transaction', { transactionId });

        set((state) => {
          const index = state.entries.findIndex((entry) => entry.processed === processed);
          if (index === -1) return state;
          const updated = [...state.entries];
          updated[index] = { ...updated[index], transactionId };
          return { entries: updated };
        });
      },
    }),
    persistConfig({
      name: 'scan-history-store',
      storage: profileStorage,
      schema: PersistedScanHistoryStore,
      partialize: (state) => ({ entries: state.entries }),
    })
  )
);
