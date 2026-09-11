import { Asset } from 'expo-asset';
import { PUBLIC_DEMO_METADATA } from './mockPublicProfile';
import { isLegacyMockProfile } from './legacyMockProfiles';
/** Presentation fixtures only. Never inject these into live stores or caches.
 * settingsStore.mockMode is the sole selector; disabling it reveals live data.
 * Legacy cleanup below removes only identifiable fixtures from older builds.
 */

import { create } from 'zustand';
import { storeLog } from '@/shared/lib/logger';
import { useScanHistoryStore, type ScanSource } from '@/shared/stores/profile/scanHistoryStore';
import {
  useSwapTransactionsStore,
  type SwapGroup,
} from '@/shared/stores/profile/swapTransactionsStore';
import { useTransactionLocationStore } from '@/shared/stores/profile/transactionLocationStore';
import {
  useNostrMetadataCache,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import type { HistoryEntry } from '@cashu/coco-core';
import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
// Type-only import — `useRecentContacts` does not import this file at runtime
// (it reads mock state via getMockState() below), so there's no cycle.
import type { RecentContact } from '@/features/payments/data/recentContactTypes';

// ---------------------------------------------------------------------------
// Demo row definition — single source of truth for all mock data.
// ---------------------------------------------------------------------------

const MINTS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.macadamia.cash',
  'https://mint.cubabitcoin.org',
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

    const base = {
      id,
      source: 'legacy' as const,
      legacyHistoryId: id,
      createdAt,
      updatedAt: createdAt,
      mintUrl,
      unit: 'sat' as const,
      amount: row.amount,
    };

    if (row.type === 'melt') {
      history.push(
        asHistoryEntry({ ...base, type: 'melt', quoteId: `${id}-q`, state: 'PAID' as const })
      );
    } else if (row.type === 'mint') {
      history.push(
        asHistoryEntry({
          ...base,
          type: 'mint',
          paymentRequest:
            'lnbc500u1pnxk4ppq0gfq2ue6m8k5tvz6gwldkdhjr07samkjhy5palzqrn64aqxgx0qdqu2askcmr9wssx7e3q2dshgmmndp5scqzzsxqyz5vqsp5usycvxaz',
          quoteId: `${id}-q`,
          state: 'ISSUED' as const,
        })
      );
    } else if (row.type === 'receive') {
      history.push(asHistoryEntry({ ...base, type: 'receive', state: 'finalized' }));
    } else if (row.type === 'send') {
      history.push(
        asHistoryEntry({
          ...base,
          type: 'send',
          operationId: `${id}-op`,
          state: 'pending' as const,
        })
      );
    } else if (row.type === 'send-cancelled') {
      history.push(
        asHistoryEntry({
          ...base,
          type: 'send',
          operationId: `${id}-op`,
          state: 'rolledBack' as const,
        })
      );
    }

    if ('badge' in row && row.badge) {
      const scanType = row.type === 'melt' || row.type === 'mint' ? 'lightning' : 'ecash';
      scanEntries.push({
        id: `demo-scan-${i}`,
        raw: `demo-raw-${i}`,
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
    .reduce((sum, e) => sum + amountToNumber(e.amount), 0);

  return { history, scanEntries, swapGroups, locations, balance: 247_382, pendingAmount };
}

// ---------------------------------------------------------------------------
// Mock contacts + DM threads
//
// Fictional demo identities have no signer, payment address, or real person's key.
interface MockContact {
  pubkey: string;
  metadata: Omit<NostrProfileMetadata, 'fetchedAt'>;
  thread: readonly { content: string; isOwn: boolean; minutesAgo: number }[];
}
const MOCK_CONTACTS: readonly MockContact[] = [
  {
    pubkey: 'b362ccc4912c046428cf9d80b742f44d7fb5a19fa1c227cccb779b2a1f61ef1c',
    metadata: {
      name: 'maya',
      displayName: 'Maya Chen',
      about: 'Fictional demo contact.',
      picture: Asset.fromModule(require('../../../assets/demo/fictional-maya/image.png')).uri,
    },
    thread: [
      { content: 'Coffee after the meetup?', isOwn: false, minutesAgo: 38 },
      { content: 'Sounds good! Same place?', isOwn: true, minutesAgo: 23 },
      { content: 'Yes! See you there ☕', isOwn: false, minutesAgo: 8 },
    ],
  },
  {
    pubkey: 'c0068b3c6e1dafed39cf8f0e137857d12715221ad38db5b01fd11a1d5c9baa33',
    metadata: {
      name: 'jamie',
      displayName: 'Jamie Brooks',
      about: 'Fictional demo contact.',
      picture: Asset.fromModule(require('../../../assets/demo/fictional-jamie/image.png')).uri,
    },
    thread: [
      { content: 'Made it home?', isOwn: false, minutesAgo: 46 },
      { content: 'Just got in. Thanks for dinner!', isOwn: true, minutesAgo: 31 },
      { content: 'Next one is on me 😊', isOwn: false, minutesAgo: 16 },
    ],
  },
  {
    pubkey: 'f090f8d7311ac41f64dcd05db9c89a07102d3e79126e98f9d7073ce4f3b8e3c8',
    metadata: {
      name: 'sofia',
      displayName: 'Sofia Costa',
      about: 'Fictional demo contact.',
      picture: Asset.fromModule(require('../../../assets/demo/fictional-sofia/image.png')).uri,
    },
    thread: [
      { content: 'Found a beautiful trail for Saturday.', isOwn: false, minutesAgo: 54 },
      { content: 'Send me the details!', isOwn: true, minutesAgo: 39 },
      { content: 'I’ll bring coffee and a camera.', isOwn: false, minutesAgo: 24 },
    ],
  },
  {
    pubkey: '6e99ae9ac3aab13dba8595b1acb0594132cf681533e235ef2d9dbe6d8866bb21',
    metadata: {
      name: 'leo',
      displayName: 'Leo Martin',
      about: 'Fictional demo contact.',
      picture: Asset.fromModule(require('../../../assets/demo/fictional-leo/image.png')).uri,
    },
    thread: [
      { content: 'Are you coming to the meetup?', isOwn: false, minutesAgo: 62 },
      { content: 'Absolutely. See you at six!', isOwn: true, minutesAgo: 47 },
      { content: 'Great, I saved you a seat.', isOwn: false, minutesAgo: 32 },
    ],
  },
];

/** Real public contacts have metadata only; invented DMs belong to fictional people. */
export const MOCK_ALLOWED_PUBKEYS_HEX: ReadonlySet<string> = new Set([
  'c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81',
  '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
]);
const EFFECTIVE_MOCK_CONTACTS = MOCK_CONTACTS;

interface MockDmMessage {
  id: string;
  content: string;
  isOwn: boolean;
  created_at: number;
  pubkey: string;
}

function buildMockContactsAndThreads(now: number) {
  const metadataByPubkey: Record<string, Omit<NostrProfileMetadata, 'fetchedAt'>> = {};
  const threadsByPubkey: Record<string, MockDmMessage[]> = {};
  const recentContacts: RecentContact[] = [];

  for (const c of EFFECTIVE_MOCK_CONTACTS) {
    metadataByPubkey[c.pubkey] = c.metadata;

    const messages: MockDmMessage[] = c.thread.map((m, idx) => {
      const created_at = Math.floor((now - m.minutesAgo * 60_000) / 1000);
      return {
        id: `demo-dm-${c.pubkey.slice(0, 8)}-${idx}`,
        content: m.content,
        isOwn: m.isOwn,
        created_at,
        // Own messages have an empty senderId in the ChatBubble pipeline; the
        // counterparty's pubkey is what the avatar/name look up. We never
        // need the *user's* real pubkey here.
        pubkey: m.isOwn ? '' : c.pubkey,
      };
    });
    threadsByPubkey[c.pubkey] = messages;

    const last = messages[messages.length - 1];
    recentContacts.push({
      type: 'contact',
      pubkey: c.pubkey,
      // ContactsScreen reads `dmEvent.content` as the row's last-message preview.
      // Skipping the rest of the NDKEvent shape is fine: nothing else on the
      // row touches it.
      dmEvent: last ? { content: last.content, isOwn: last.isOwn } : null,
      nip17Content: last?.content,
      timestamp: last?.created_at ?? 0,
    });
  }

  return { metadataByPubkey, threadsByPubkey, recentContacts };
}

const MOCK_PUBKEYS_SET: ReadonlySet<string> = new Set(EFFECTIVE_MOCK_CONTACTS.map((c) => c.pubkey));

export function isMockContactPubkey(pubkey: string | null | undefined): boolean {
  return !!pubkey && MOCK_PUBKEYS_SET.has(pubkey);
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

const MOCK = buildMockData();
const MOCK_DM = buildMockContactsAndThreads(Date.now());

/** Mock RecentContact rows. Consumed by `useRecentContacts` when mockMode is on. */
export function getMockContacts(): RecentContact[] {
  return MOCK_DM.recentContacts;
}

/** Mock DM thread for a counterparty pubkey, oldest-first. */
export function getMockDmThread(pubkey: string): MockDmMessage[] | null {
  return MOCK_DM.threadsByPubkey[pubkey] ?? null;
}

/** Pure profile overlay. Callers must gate this by the reactive mockMode flag. */
export function getMockProfileMetadata(pubkey: string): NostrProfileMetadata | undefined {
  return PUBLIC_DEMO_METADATA.get(pubkey) ?? MOCK_PROFILE_METADATA[pubkey];
}

const MOCK_PROFILE_METADATA: Record<string, NostrProfileMetadata> = Object.fromEntries(
  Object.entries(MOCK_DM.metadataByPubkey).map(([pubkey, metadata]) => [
    pubkey,
    { ...metadata, fetchedAt: Date.now() },
  ])
);

/** Presentation balances only. Never use these for spendability or mint selection eligibility. */
export const MOCK_MINT_BALANCES: Readonly<Record<string, number>> = {
  'https://mint.macadamia.cash': 110_000,
  'https://antifiat.cash': 90_000,
  'https://mint.cubabitcoin.org': 47_382,
};

export function getMockMintBalance(mintUrl: string, unit: string): number {
  return unit.toLowerCase() === 'sat' ? (MOCK_MINT_BALANCES[mintUrl.replace(/\/$/, '')] ?? 0) : 0;
}

export const MOCK_SWAP_GROUPS: Record<string, SwapGroup> = Object.fromEntries(
  MOCK.swapGroups.map((group) => [group.id, group])
);

function afterHydrationOnce(
  store: { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } },
  cleanup: () => void
) {
  if (store.persist.hasHydrated()) {
    cleanup();
    return;
  }
  const unsubscribe = store.persist.onFinishHydration(() => {
    unsubscribe();
    cleanup();
  });
}

/** Upgrade cleanup is independent of Mock Mode. No listeners ever re-inject data. */
export function purgeLegacyMockData() {
  afterHydrationOnce(useNostrMetadataCache, () => {
    useNostrMetadataCache.setState((state) => {
      const byPubkey = Object.fromEntries(
        Object.entries(state.byPubkey).filter(
          ([pubkey, metadata]) => !isLegacyMockProfile(pubkey, metadata)
        )
      );
      if (Object.keys(byPubkey).length === Object.keys(state.byPubkey).length) return state;
      storeLog.info('mock.fixture_metadata_purged', {
        removed: Object.keys(state.byPubkey).length - Object.keys(byPubkey).length,
      });
      return { byPubkey };
    });
  });
  afterHydrationOnce(useScanHistoryStore, () => {
    useScanHistoryStore.setState((state) => {
      const entries = state.entries.filter(
        (entry) => !MOCK.scanEntries.some((fixture) => fixture.id === entry.id)
      );
      if (entries.length === state.entries.length) return state;
      return {
        entries,
        entriesByTransactionId: Object.fromEntries(
          entries
            .filter((entry) => entry.transactionId)
            .map((entry) => [entry.transactionId!, entry])
        ),
      };
    });
  });
  afterHydrationOnce(useSwapTransactionsStore, () => {
    useSwapTransactionsStore.setState((state) => {
      const groups = Object.fromEntries(
        Object.entries(state.groups).filter(([id]) => !MOCK_SWAP_GROUPS[id])
      );
      return Object.keys(groups).length === Object.keys(state.groups).length ? state : { groups };
    });
  });
  afterHydrationOnce(useTransactionLocationStore, () => {
    useTransactionLocationStore.setState((state) => {
      const locations = Object.fromEntries(
        Object.entries(state.locations).filter(([id]) => !MOCK.locations[id])
      );
      return Object.keys(locations).length === Object.keys(state.locations).length
        ? state
        : { locations };
    });
  });
}

export const useMockDataStore = create<MockDataState>()(() => ({
  mockHistory: MOCK.history,
  mockBalance: MOCK.balance,
  mockPendingAmount: MOCK.pendingAmount,
}));
