/**
 * @fileoverview Mock Data Store
 *
 * Non-persisted zustand store that holds fake wallet data for demo/screenshot
 * purposes. Controlled by the `mockMode` flag in settingsStore.
 *
 * Safety:
 * - Mock history and balance are kept here (never persisted to AsyncStorage).
 * - Mock scan entries and swap groups are injected into the real persisted
 *   stores with `demo-` prefixed IDs. On deactivate they are cleanly removed.
 * - `onFinishHydration` callbacks re-inject after AsyncStorage rehydration.
 */

import { create } from 'zustand';
import { useScanHistoryStore, type ScanSource } from '@/shared/stores/profile/scanHistoryStore';
import {
  useSwapTransactionsStore,
  type SwapGroup,
} from '@/shared/stores/profile/swapTransactionsStore';
import { useTransactionLocationStore } from '@/shared/stores/profile/transactionLocationStore';
import type { HistoryEntry } from '@cashu/coco-core';

// ---------------------------------------------------------------------------
// Demo row definition — single source of truth for all mock data.
// ---------------------------------------------------------------------------

const MINTS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.coinos.io',
  'https://nofees.testnut.cashu.space',
];

type DemoRow =
  | { type: 'melt'; amount: number; badge?: ScanSource }
  | { type: 'mint'; amount: number; badge?: ScanSource }
  | { type: 'receive'; amount: number; badge?: ScanSource }
  | { type: 'send'; amount: number; badge?: ScanSource }
  | { type: 'send-cancelled'; amount: number; badge?: ScanSource }
  | { type: 'swap'; amount: number };

const DEMO_ROWS: DemoRow[] = [
  { type: 'melt', amount: 1_430, badge: 'paste' },
  { type: 'mint', amount: 3_200, badge: 'qr' },
  { type: 'send-cancelled', amount: 4_200 },
  { type: 'receive', amount: 8_400, badge: 'deeplink' },
  { type: 'send', amount: 21_000, badge: 'nfc' },
  { type: 'swap', amount: 32_768 },
];

// Staggered offsets so transactions look naturally spread across the day
const TIME_OFFSETS_MS = [
  12 * 60_000, // 12 min ago
  47 * 60_000, // 47 min ago
  2.3 * 3_600_000, // ~2 h ago
  5.1 * 3_600_000, // ~5 h ago
  11 * 3_600_000, // ~11 h ago
  23 * 3_600_000, // ~23 h ago
];

// ---------------------------------------------------------------------------
// Build all mock artifacts from the declarative row list.
// ---------------------------------------------------------------------------

interface ScanEntry {
  id: string;
  raw: string;
  processed: string;
  type: 'lightning' | 'ecash';
  source: ScanSource;
  scannedAt: number;
  transactionId: string;
}

function buildMockData() {
  const now = Date.now();
  const history: HistoryEntry[] = [];
  const scanEntries: ScanEntry[] = [];
  const swapGroups: SwapGroup[] = [];

  DEMO_ROWS.forEach((row, i) => {
    const id = `demo-${row.type}-${i}`;
    const createdAt = now - TIME_OFFSETS_MS[i];
    const mintUrl = MINTS[i % MINTS.length];

    if (row.type === 'swap') {
      swapGroups.push({
        id,
        unit: 'sat',
        createdAt,
        title: 'Swap',
        state: 'finished',
        legs: [
          {
            id: `${id}-leg`,
            fromMintUrl: MINTS[0],
            toMintUrl: MINTS[1],
            amount: row.amount,
            localStatus: 'done',
          },
        ],
      });
      return;
    }

    const base = { id, createdAt, mintUrl, unit: 'sat' as const, amount: row.amount };

    if (row.type === 'melt') {
      history.push({ ...base, type: 'melt', quoteId: `${id}-q`, state: 'PAID' as const });
    } else if (row.type === 'mint') {
      history.push({
        ...base,
        type: 'mint',
        paymentRequest:
          'lnbc500u1pnxk4ppq0gfq2ue6m8k5tvz6gwldkdhjr07samkjhy5palzqrn64aqxgx0qdqu2askcmr9wssx7e3q2dshgmmndp5scqzzsxqyz5vqsp5usycvxaz',
        quoteId: `${id}-q`,
        state: 'PAID' as const,
      });
    } else if (row.type === 'receive') {
      history.push({ ...base, type: 'receive', state: 'finalized' });
    } else if (row.type === 'send') {
      history.push({
        ...base,
        type: 'send',
        operationId: `${id}-op`,
        state: 'pending' as const,
      });
    } else if (row.type === 'send-cancelled') {
      history.push({
        ...base,
        type: 'send',
        operationId: `${id}-op`,
        state: 'rolledBack' as const,
      });
    }

    if ('badge' in row && row.badge) {
      const scanType = row.type === 'melt' || row.type === 'mint' ? 'lightning' : 'ecash';
      scanEntries.push({
        id: `demo-scan-${i}`,
        raw: `demo-raw-${i}`,
        processed: `demo-raw-${i}`,
        type: scanType,
        source: row.badge,
        scannedAt: createdAt,
        transactionId: id,
      });
    }
  });

  // Random NYC-area locations for completed transactions
  const NYC_LOCATIONS: { latitude: number; longitude: number }[] = [
    { latitude: 40.758, longitude: -73.9855 }, // Times Square
    { latitude: 40.7484, longitude: -73.9857 }, // Empire State Building
    { latitude: 40.7061, longitude: -74.0089 }, // Tribeca
    { latitude: 40.7282, longitude: -73.7949 }, // Jamaica, Queens
    { latitude: 40.6892, longitude: -74.0445 }, // Statue of Liberty area
    { latitude: 40.7527, longitude: -73.9772 }, // Grand Central
  ];

  const locations: Record<string, { latitude: number; longitude: number; createdAt: number }> = {};
  history.forEach((entry, i) => {
    // Only add locations for completed (non-cancelled) transactions
    const isCancelled = entry.type === 'send' && 'state' in entry && entry.state === 'rolledBack';
    if (!isCancelled) {
      const loc = NYC_LOCATIONS[i % NYC_LOCATIONS.length];
      locations[entry.id] = { ...loc, createdAt: entry.createdAt };
    }
  });

  const pendingAmount = history
    .filter((e) => e.type === 'send' && 'state' in e && e.state === 'pending')
    .reduce((sum, e) => sum + e.amount, 0);

  return { history, scanEntries, swapGroups, locations, balance: 247_382, pendingAmount };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface MockDataState {
  /** Pre-built mock history entries (not persisted). */
  mockHistory: HistoryEntry[];
  /** Fake primary balance in sats. */
  mockBalance: number;
  /** Fake pending ecash total in sats. */
  mockPendingAmount: number;
}

interface MockDataActions {
  /**
   * Inject demo- prefixed entries into scanHistoryStore and
   * swapTransactionsStore. Subscribe to rehydration so entries survive
   * AsyncStorage reload.
   */
  activate: () => void;
  /**
   * Remove all demo- prefixed entries from real stores and unsubscribe
   * rehydration listeners.
   */
  deactivate: () => void;
}

type MockDataStore = MockDataState & MockDataActions;

const MOCK = buildMockData();

// Hydration unsubscribe handles — stored outside zustand state so they
// are never serialised / compared.
let unsubScans: (() => void) | null = null;
let unsubSwaps: (() => void) | null = null;
let unsubLocations: (() => void) | null = null;

function injectScans() {
  useScanHistoryStore.setState((state) => ({
    entries: [...state.entries.filter((e) => !e.id.startsWith('demo-')), ...MOCK.scanEntries],
  }));
}

function injectSwaps() {
  if (MOCK.swapGroups.length === 0) return;
  useSwapTransactionsStore.setState((state) => {
    const merged = { ...state.groups };
    for (const g of MOCK.swapGroups) merged[g.id] = g;
    return { groups: merged };
  });
}

function removeScans() {
  useScanHistoryStore.setState((state) => ({
    entries: state.entries.filter((e) => !e.id.startsWith('demo-')),
  }));
}

function removeSwaps() {
  useSwapTransactionsStore.setState((state) => {
    const cleaned: Record<string, SwapGroup> = {};
    for (const [k, v] of Object.entries(state.groups)) {
      if (!k.startsWith('demo-')) cleaned[k] = v;
    }
    return { groups: cleaned };
  });
}

function injectLocations() {
  useTransactionLocationStore.setState((state) => ({
    locations: { ...state.locations, ...MOCK.locations },
  }));
}

function removeLocations() {
  useTransactionLocationStore.setState((state) => {
    const cleaned: Record<string, { latitude: number; longitude: number; createdAt: number }> = {};
    for (const [k, v] of Object.entries(state.locations)) {
      if (!k.startsWith('demo-')) cleaned[k] = v;
    }
    return { locations: cleaned };
  });
}

export const useMockDataStore = create<MockDataStore>()((_set) => ({
  // Pre-built mock data — never changes at runtime.
  mockHistory: MOCK.history,
  mockBalance: MOCK.balance,
  mockPendingAmount: MOCK.pendingAmount,

  activate: () => {
    // Inject immediately
    injectScans();
    injectSwaps();
    injectLocations();

    // Re-inject after rehydration from AsyncStorage
    unsubScans = useScanHistoryStore.persist.onFinishHydration(injectScans);
    unsubSwaps = useSwapTransactionsStore.persist.onFinishHydration(injectSwaps);
    unsubLocations = useTransactionLocationStore.persist.onFinishHydration(injectLocations);
  },

  deactivate: () => {
    // Unsubscribe rehydration listeners
    unsubScans?.();
    unsubSwaps?.();
    unsubLocations?.();
    unsubScans = null;
    unsubSwaps = null;
    unsubLocations = null;

    // Remove all demo entries from real stores
    removeScans();
    removeSwaps();
    removeLocations();
  },
}));
