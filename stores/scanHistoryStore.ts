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
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/helper/profileScopedStorage';

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
  addScan: (raw: string, processed: string, type: ScanType, source: ScanSource) => void;
  /** Get all scan history entries */
  getEntries: () => ScanHistoryEntry[];
  /** Get entries filtered by type */
  getEntriesByType: (type: ScanType) => ScanHistoryEntry[];
  /** Get most recent scans (default: 20) */
  getRecentScans: (limit?: number) => ScanHistoryEntry[];
  /** Get most recent scans of a specific type */
  getRecentScansByType: (type: ScanType, limit?: number) => ScanHistoryEntry[];
  /** Check if a raw string has been scanned before */
  hasScanned: (raw: string) => boolean;
  /** Find an entry by raw string */
  findByRaw: (raw: string) => ScanHistoryEntry | undefined;
  /** Find an entry by processed string */
  findByProcessed: (processed: string) => ScanHistoryEntry | undefined;
  /** Find an entry by transaction ID */
  findByTransactionId: (transactionId: string) => ScanHistoryEntry | undefined;
  /** Link a scan entry to a transaction by matching the processed string */
  linkTransaction: (processed: string, transactionId: string) => void;
  /** Remove a specific entry by id */
  removeEntry: (id: string) => void;
  /** Clear all history */
  clearHistory: () => void;
  /** Clear history for a specific type */
  clearHistoryByType: (type: ScanType) => void;
  /** Clear all stored data (state + AsyncStorage) */
  clearAllData: () => Promise<void>;
}

type ScanHistoryStore = ScanHistoryState & ScanHistoryActions;

const generateId = () => `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const useScanHistoryStore = create<ScanHistoryStore>()(
  persist(
    (set, get) => ({
      // Initial state
      entries: [],

      // Add a scan to history
      addScan: (raw: string, processed: string, type: ScanType, source: ScanSource) => {
        const { entries } = get();
        const now = Date.now();

        // Check if this raw string was already scanned
        const existingIndex = entries.findIndex((entry) => entry.raw === raw);

        if (existingIndex !== -1) {
          // Update timestamp and source for existing entry
          const updated = [...entries];
          updated[existingIndex] = {
            ...updated[existingIndex],
            source,
            scannedAt: now,
          };
          set({ entries: updated });
        } else {
          // Add new entry
          const newEntry: ScanHistoryEntry = {
            id: generateId(),
            raw,
            processed,
            type,
            source,
            scannedAt: now,
          };
          set({ entries: [...entries, newEntry] });
        }
      },

      // Get all entries
      getEntries: () => {
        return get().entries;
      },

      // Get entries filtered by type
      getEntriesByType: (type: ScanType) => {
        return get().entries.filter((entry) => entry.type === type);
      },

      // Get most recent scans
      getRecentScans: (limit = 20) => {
        const { entries } = get();
        return [...entries].sort((a, b) => b.scannedAt - a.scannedAt).slice(0, limit);
      },

      // Get most recent scans of a specific type
      getRecentScansByType: (type: ScanType, limit = 20) => {
        const { entries } = get();
        return [...entries]
          .filter((entry) => entry.type === type)
          .sort((a, b) => b.scannedAt - a.scannedAt)
          .slice(0, limit);
      },

      // Check if a raw string has been scanned
      hasScanned: (raw: string) => {
        return get().entries.some((entry) => entry.raw === raw);
      },

      // Find by raw string
      findByRaw: (raw: string) => {
        return get().entries.find((entry) => entry.raw === raw);
      },

      // Find by processed string
      findByProcessed: (processed: string) => {
        return get().entries.find((entry) => entry.processed === processed);
      },

      // Find by transaction ID
      findByTransactionId: (transactionId: string) => {
        return get().entries.find((entry) => entry.transactionId === transactionId);
      },

      // Link a scan entry to a transaction by matching the processed string
      linkTransaction: (processed: string, transactionId: string) => {
        if (!processed || !transactionId) return;

        const { entries } = get();
        const index = entries.findIndex((entry) => entry.processed === processed);

        if (index !== -1) {
          const updated = [...entries];
          updated[index] = {
            ...updated[index],
            transactionId,
          };
          set({ entries: updated });
        }
      },

      // Remove entry by id
      removeEntry: (id: string) => {
        const { entries } = get();
        set({ entries: entries.filter((entry) => entry.id !== id) });
      },

      // Clear all history
      clearHistory: () => {
        set({ entries: [] });
      },

      // Clear history for a specific type
      clearHistoryByType: (type: ScanType) => {
        const { entries } = get();
        set({ entries: entries.filter((entry) => entry.type !== type) });
      },

      // Clear all stored data (state + AsyncStorage)
      clearAllData: async () => {
        try {
          await profileStorage.removeItem('scan-history-store');
          set({ entries: [] });
        } catch (error) {
          console.error('ScanHistoryStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'scan-history-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
    }
  )
);
