/**
 * @fileoverview Mock Data Store
 *
 * Non-persisted zustand store that holds fake wallet data for demo/screenshot
 * purposes. Controlled by the `mockMode` flag in settingsStore.
 *
 * Safety:
 * - Mock history and balance are kept here (never persisted to AsyncStorage).
 * - Mock scan entries, swap groups, and locations are injected into the real
 *   in-memory stores with `demo-` prefixed IDs, but the persist middleware is
 *   gated off for these writes via `withSkippedPersistWrites`, so demo data
 *   never reaches AsyncStorage.
 * - `onFinishHydration` callbacks re-inject after AsyncStorage rehydration.
 */

import { create } from 'zustand';
import { nip19 } from 'nostr-tools';
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
import { withSkippedPersistWrites } from '@/shared/lib/cashu/profileScopedStorage';
import { amountToNumber, toCocoAmount } from '@/shared/lib/cashu/amount';
import type { HistoryEntry } from '@cashu/coco-core';
// Type-only import — `useRecentContacts` does not import this file at runtime
// (it reads mock state via getMockState() below), so there's no cycle.
import type { RecentContact } from '@/features/payments/hooks/useNip17RecentContacts';

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
      amount: toCocoAmount(row.amount),
    };

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
// Real npubs (decoded to hex once at module load) so deep-links and copy-pubkey
// affordances stay coherent — the threads themselves are entirely fabricated
// and never publish anywhere.
// ---------------------------------------------------------------------------

interface MockContact {
  /** 64-hex Schnorr key. */
  pubkey: string;
  /** Bech32 form, retained for display affordances (copy as npub). */
  npub: string;
  metadata: Omit<NostrProfileMetadata, 'fetchedAt'>;
  /** Deterministic thread, oldest first. ISO-ish offsets from `now` in minutes. */
  thread: readonly { content: string; isOwn: boolean; minutesAgo: number }[];
}

const MOCK_CONTACTS: readonly MockContact[] = [
  {
    pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
    npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
    metadata: {
      name: 'satoshi',
      displayName: 'Satoshi',
      about: 'Just a guy who likes peer-to-peer cash.',
      nip05: 'satoshi@sovran.money',
      lud16: 'satoshi@sovran.money',
    },
    thread: [
      { content: 'hey, you free for lunch?', isOwn: false, minutesAgo: 240 },
      { content: 'yeah, 1pm at the usual spot?', isOwn: true, minutesAgo: 235 },
      { content: 'perfect. bringing the new hardware to show you', isOwn: false, minutesAgo: 230 },
      { content: 'oh nice, finally', isOwn: true, minutesAgo: 14 },
    ],
  },
  {
    pubkey: '50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63',
    npub: 'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg',
    metadata: {
      name: 'alice',
      displayName: 'Alice',
      about: 'mint operator. occasionally pays for coffee in sats.',
      nip05: 'alice@sovran.money',
      lud16: 'alice@sovran.money',
    },
    thread: [
      { content: 'invoice please?', isOwn: false, minutesAgo: 90 },
      { content: 'one sec', isOwn: true, minutesAgo: 89 },
      { content: 'lnbc500u1pnxk4ppq0gfq2ue6m8k5tvz6gwldkdhjr07s', isOwn: true, minutesAgo: 88 },
      { content: 'paid. thanks!', isOwn: false, minutesAgo: 47 },
    ],
  },
  {
    pubkey: '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
    npub: 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m',
    metadata: {
      name: 'bob',
      displayName: 'Bob',
      about: 'split bills with me, not with banks.',
      nip05: 'bob@sovran.money',
    },
    thread: [
      { content: 'split the dinner?', isOwn: true, minutesAgo: 60 * 26 },
      { content: 'sure, send me a request', isOwn: false, minutesAgo: 60 * 25 },
      { content: 'sent', isOwn: true, minutesAgo: 60 * 24 },
    ],
  },
  {
    pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
    npub: 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6',
    metadata: {
      name: 'carol',
      displayName: 'Carol',
      about: 'nostr, NFC, and overpriced espresso.',
      lud16: 'carol@sovran.money',
    },
    thread: [
      { content: 'tap to pay worked first try 🎉', isOwn: false, minutesAgo: 60 * 72 },
      { content: "told you it'd be smooth", isOwn: true, minutesAgo: 60 * 71 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Mock-mode contacts allowlist
//
// In mock mode the Contacts screen is restricted to ONLY the npubs in this
// list (every other contact, mint, request, BLE peer is hidden). Crucially,
// pubkeys on this list use REAL Nostr data — they are excluded from every
// mock injection below (metadata, threads, recent-contacts rows, the
// `isMockContactPubkey` check). That way a collision between an allowlisted
// npub and an entry in `MOCK_CONTACTS` (e.g. "alice") does not shadow real
// kind-0 metadata or real DM history.
//
// To add a real contact to the demo, append its npub here.
// ---------------------------------------------------------------------------

const MOCK_ALLOWED_NPUBS: readonly string[] = [
  'npub1ceel7z6ly287kz4mzqqcsgtc6nzc30zw2ru9w9e4gj64gw69f7qscyf0p8',
  'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
] as const;

export const MOCK_ALLOWED_PUBKEYS_HEX: ReadonlySet<string> = new Set(
  MOCK_ALLOWED_NPUBS.map((npub) => {
    const decoded = nip19.decode(npub);
    return decoded.type === 'npub' ? (decoded.data as string) : '';
  }).filter(Boolean)
);

// Mocks that are NOT shadowed by the allowlist. Single source of truth for
// every runtime injection below — keep `MOCK_CONTACTS` itself intact so the
// raw demo data is auditable and easy to repopulate later.
const EFFECTIVE_MOCK_CONTACTS = MOCK_CONTACTS.filter(
  (c) => !MOCK_ALLOWED_PUBKEYS_HEX.has(c.pubkey)
);

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
      dmEvent: last ? { content: last.content } : null,
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
const MOCK_DM = buildMockContactsAndThreads(Date.now());

/** Mock RecentContact rows. Consumed by `useRecentContacts` when mockMode is on. */
export function getMockContacts(): RecentContact[] {
  return MOCK_DM.recentContacts;
}

/** Mock DM thread for a counterparty pubkey, oldest-first. */
export function getMockDmThread(pubkey: string): MockDmMessage[] | null {
  return MOCK_DM.threadsByPubkey[pubkey] ?? null;
}

// Hydration unsubscribe handles — stored outside zustand state so they
// are never serialised / compared.
let unsubScans: (() => void) | null = null;
let unsubSwaps: (() => void) | null = null;
let unsubLocations: (() => void) | null = null;
let unsubMetadata: (() => void) | null = null;

// All inject/remove helpers gate the persist middleware off via
// `withSkippedPersistWrites` so demo entries stay runtime-only and never
// leak into AsyncStorage. A force-quit while mockMode is on therefore
// cannot leave `demo-`-prefixed entries behind in the persisted blob.

function injectScans() {
  withSkippedPersistWrites(() => {
    useScanHistoryStore.setState((state) => ({
      entries: [...state.entries.filter((e) => !e.id.startsWith('demo-')), ...MOCK.scanEntries],
    }));
  });
}

function injectSwaps() {
  if (MOCK.swapGroups.length === 0) return;
  withSkippedPersistWrites(() => {
    useSwapTransactionsStore.setState((state) => {
      const merged = { ...state.groups };
      for (const g of MOCK.swapGroups) merged[g.id] = g;
      return { groups: merged };
    });
  });
}

function removeScans() {
  withSkippedPersistWrites(() => {
    useScanHistoryStore.setState((state) => ({
      entries: state.entries.filter((e) => !e.id.startsWith('demo-')),
    }));
  });
}

function removeSwaps() {
  withSkippedPersistWrites(() => {
    useSwapTransactionsStore.setState((state) => {
      const cleaned: Record<string, SwapGroup> = {};
      for (const [k, v] of Object.entries(state.groups)) {
        if (!k.startsWith('demo-')) cleaned[k] = v;
      }
      return { groups: cleaned };
    });
  });
}

function injectLocations() {
  withSkippedPersistWrites(() => {
    useTransactionLocationStore.setState((state) => ({
      locations: { ...state.locations, ...MOCK.locations },
    }));
  });
}

function removeLocations() {
  withSkippedPersistWrites(() => {
    useTransactionLocationStore.setState((state) => {
      const cleaned: Record<string, { latitude: number; longitude: number; createdAt: number }> =
        {};
      for (const [k, v] of Object.entries(state.locations)) {
        if (!k.startsWith('demo-')) cleaned[k] = v;
      }
      return { locations: cleaned };
    });
  });
}

function injectNostrMetadata() {
  // Seed kind-0 metadata so ContactRow / DmChatHeader / profile screens show
  // the mock name + nip05 / about / lud16 instead of the deterministic
  // "word-pair" fallback. fetchedAt: now keeps the SWR hook from triggering
  // a relay refetch.
  withSkippedPersistWrites(() => {
    const now = Date.now();
    useNostrMetadataCache.setState((state) => {
      const next = { ...state.byPubkey };
      for (const [pubkey, metadata] of Object.entries(MOCK_DM.metadataByPubkey)) {
        next[pubkey] = { ...metadata, fetchedAt: now };
      }
      return { byPubkey: next };
    });
  });
}

function removeNostrMetadata() {
  withSkippedPersistWrites(() => {
    useNostrMetadataCache.setState((state) => {
      const next = { ...state.byPubkey };
      for (const pubkey of Object.keys(MOCK_DM.metadataByPubkey)) {
        delete next[pubkey];
      }
      return { byPubkey: next };
    });
  });
}

function purgeFixtureMetadataNow() {
  useNostrMetadataCache.setState((state) => {
    let removed = 0;
    const next = { ...state.byPubkey };
    for (const pubkey of Object.keys(MOCK_DM.metadataByPubkey)) {
      if (pubkey in next) {
        delete next[pubkey];
        removed += 1;
      }
    }
    if (removed === 0) return state;
    // Deliberately NOT wrapped in withSkippedPersistWrites: unlike the
    // in-memory inject/remove, this must PERSIST the deletion so leaked fixture
    // identities (Bob/Alice/…) that were written to AsyncStorage in a previous
    // build never rehydrate again.
    storeLog.info('mock.fixture_metadata_purged', { removed });
    return { byPubkey: next };
  });
}

/**
 * Permanently drop any persisted mock fixture metadata (Bob/Alice/…) from the
 * Nostr metadata cache. Called at launch when mock mode is off so demo
 * identities can never leak through real surfaces. Idempotent and a no-op when
 * nothing leaked. Waits for the cache to hydrate so it sees the persisted blob.
 */
export function purgeFixtureMetadata() {
  if (useNostrMetadataCache.persist.hasHydrated()) {
    purgeFixtureMetadataNow();
    return;
  }
  const unsub = useNostrMetadataCache.persist.onFinishHydration(() => {
    purgeFixtureMetadataNow();
    unsub?.();
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
    injectNostrMetadata();

    // Re-inject after rehydration from AsyncStorage
    unsubScans = useScanHistoryStore.persist.onFinishHydration(injectScans);
    unsubSwaps = useSwapTransactionsStore.persist.onFinishHydration(injectSwaps);
    unsubLocations = useTransactionLocationStore.persist.onFinishHydration(injectLocations);
    unsubMetadata = useNostrMetadataCache.persist.onFinishHydration(injectNostrMetadata);
  },

  deactivate: () => {
    // Unsubscribe rehydration listeners
    unsubScans?.();
    unsubSwaps?.();
    unsubLocations?.();
    unsubMetadata?.();
    unsubScans = null;
    unsubSwaps = null;
    unsubLocations = null;
    unsubMetadata = null;

    // Remove all demo entries from real stores
    removeScans();
    removeSwaps();
    removeLocations();
    removeNostrMetadata();
  },
}));
