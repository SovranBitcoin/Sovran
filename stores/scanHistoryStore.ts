/**
 * @fileoverview Scan History Store
 *
 * Keeps track of all QR codes/strings that have been scanned.
 * Stores both raw and processed versions for different use cases.
 *
 * This can be used for:
 * - Recently scanned items
 * - Scan analytics
 * - Quick re-access to previously scanned data
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ScanType = 'npub' | 'ecash' | 'lightning' | 'mint' | 'unknown';

export interface ScanHistoryEntry {
  /** Unique identifier for this scan */
  id: string;
  /** The raw string as scanned from QR code */
  raw: string;
  /** The processed/normalized string (e.g., npub without nostr: prefix) */
  processed: string;
  /** Type of the scanned data */
  type: ScanType;
  /** Timestamp when scanned */
  scannedAt: number;
}

interface ScanHistoryState {
  entries: ScanHistoryEntry[];
}

interface ScanHistoryActions {
  /** Add a scan to history */
  addScan: (raw: string, processed: string, type: ScanType) => void;
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
  /** Remove a specific entry by id */
  removeEntry: (id: string) => void;
  /** Clear all history */
  clearHistory: () => void;
  /** Clear history for a specific type */
  clearHistoryByType: (type: ScanType) => void;
}

type ScanHistoryStore = ScanHistoryState & ScanHistoryActions;

const generateId = () => `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const useScanHistoryStore = create<ScanHistoryStore>()(
  persist(
    (set, get) => ({
      // Initial state
      entries: [],

      // Add a scan to history
      addScan: (raw: string, processed: string, type: ScanType) => {
        const { entries } = get();
        const now = Date.now();

        // Check if this raw string was already scanned
        const existingIndex = entries.findIndex((entry) => entry.raw === raw);

        if (existingIndex !== -1) {
          // Update timestamp for existing entry
          const updated = [...entries];
          updated[existingIndex] = {
            ...updated[existingIndex],
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
    }),
    {
      name: 'scan-history-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

