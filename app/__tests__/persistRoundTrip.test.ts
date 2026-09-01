/* eslint-disable import/first, @typescript-eslint/no-require-imports */

// Persisted-schema ROUND-TRIP guard.
//
// The drift snapshot next door compares each schema to its own previous shape.
// It cannot see the one failure that costs users their data outright: a schema
// that rejects what its OWN store writes. `createMergeWithSchema` is
// all-or-nothing — one rejected field discards the entire blob and falls back
// to in-memory defaults — so such a store silently wipes itself on every
// launch, logging a warning nobody reads.
//
// This asserts the floor: the JSON form of `partialize(initialState)` must
// parse against the store's own schema. It is a FLOOR, not full coverage — an
// initial state does not exercise populated rows, non-default enum variants,
// or conditional `partialize` branches. What it does catch is the whole class
// where a required field is missing from `partialize`, a field was tightened
// past what the store produces, or a default is itself invalid.
//
// The module list below is checked against the filesystem rather than trusted:
// an earlier revision of this test hand-listed the stores, silently omitted
// three, and still reported green. `covers every persistConfig caller` is what
// stops that recurring.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ normalizeRelayUrl: (url: string) => url }), {
  virtual: true,
});

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

import { persistRegistry } from '@/shared/lib/persist/persistConfig';

const APP_DIR = resolve(__dirname, '..');

/** Every module that registers a persisted store. */
const STORE_MODULES = [
  '@/features/bitchat/stores/bitchatDmMessages',
  '@/features/feed/stores/ignoreStore',
  '@/features/feed/stores/notificationPolicyStore',
  '@/features/nostrSigner/data/nip46ActivityStore',
  '@/features/nostrSigner/data/nip46ConnectionsStore',
  '@/shared/lib/nostr/media/mediaServerStore',
  '@/shared/lib/nostr/outbox/relayListStore',
  '@/shared/stores/global/btcMapStore',
  '@/shared/stores/global/mempoolAddressCache',
  '@/shared/stores/global/mintMetadataStore',
  '@/shared/stores/global/nostrMetadataCache',
  '@/shared/stores/global/pricelistStore',
  '@/shared/stores/global/profileStore',
  '@/shared/stores/global/relayMetadataStore',
  '@/shared/stores/global/settingsStore',
  '@/shared/stores/global/walletLifecycleStore',
  '@/shared/stores/global/wallpaperStore',
  '@/shared/stores/profile/dataMigrationStore',
  '@/shared/stores/profile/mintDistributionStore',
  '@/shared/stores/profile/mintStore',
  '@/shared/stores/profile/nostrSocialStore',
  '@/shared/stores/profile/npcMintStore',
  '@/shared/stores/profile/nutDropRedeemQueueStore',
  '@/shared/stores/profile/ownContentStore',
  '@/shared/stores/profile/ownedMediaStore',
  '@/shared/stores/profile/recentPeopleStore',
  '@/shared/stores/profile/routstrStore',
  '@/shared/stores/profile/scanHistoryStore',
  '@/shared/stores/profile/searchHistoryStore',
  '@/shared/stores/profile/sendReachabilityStore',
  '@/shared/stores/profile/swapTransactionsStore',
  '@/shared/stores/profile/themeStore',
  '@/shared/stores/profile/transactionAnnotationStore',
  '@/shared/stores/profile/transactionDistributionStore',
  '@/shared/stores/profile/transactionLocationStore',
] as const;

/**
 * Files that call `persistConfig` but register no fixed store name, so they
 * cannot appear in the module list above.
 */
const NOT_A_CONCRETE_STORE = ['shared/lib/cache/createQueryCacheStore.ts'];

/**
 * Registered stores whose Zustand store object is not exported, so the test
 * cannot reach their initial state to round-trip it. Keep this list empty
 * where possible — an entry here is a real coverage gap, not a waiver.
 */
const UNREACHABLE_STORE_NAMES = [
  // `mediaServerStore` keeps its store module-private and exposes only
  // `getMediaServer()` / `setMediaServer()`.
  'nostr-media-server-store',
];

function sourceFilesCalling(pattern: RegExp): string[] {
  const hits: string[] = [];
  const skip = new Set(['node_modules', 'ios', 'android', '__tests__', 'e2e', '.expo']);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && pattern.test(readFileSync(full, 'utf8'))) {
        hits.push(relative(APP_DIR, full));
      }
    }
  };
  walk(APP_DIR);
  return hits.sort();
}

interface PersistedStore {
  getState: () => unknown;
  persist: { getOptions: () => { name?: string } };
}

function isPersistedStore(value: unknown): value is PersistedStore {
  if (typeof value !== 'function') return false;
  const v = value as Partial<PersistedStore>;
  return typeof v.getState === 'function' && typeof v.persist?.getOptions === 'function';
}

/**
 * name -> initial state. Paired on Zustand's own `persist.getOptions().name`,
 * which is the same string `persistConfig` registers — exact, and immune to a
 * module having already been pulled in transitively.
 */
const statesByStoreName = new Map<string, unknown>();

for (const path of STORE_MODULES) {
  const mod = require(path) as Record<string, unknown>;
  for (const value of Object.values(mod)) {
    if (!isPersistedStore(value)) continue;
    const name = value.persist.getOptions().name;
    if (name) statesByStoreName.set(name, value.getState());
  }
}

describe('persisted store round-trip', () => {
  it('covers every persistConfig caller in the source tree', () => {
    const callers = sourceFilesCalling(/persistConfig\s*[<(]/).filter(
      (f) => !f.endsWith('persist/persistConfig.ts') && !NOT_A_CONCRETE_STORE.includes(f)
    );
    const listed = STORE_MODULES.map((m) => `${m.replace('@/', '')}.ts`).sort();
    expect(callers).toEqual(listed);
  });

  it('registers each store name exactly once', () => {
    const names = persistRegistry.map((e) => e.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it('pairs every registered store with its live state', () => {
    const unpaired = persistRegistry
      .map((e) => e.name)
      .filter((name) => !statesByStoreName.has(name))
      .sort();
    expect(unpaired).toEqual([...UNREACHABLE_STORE_NAMES].sort());
  });

  it.each(persistRegistry.map((entry) => [entry.name, entry] as const))(
    '%s accepts its own partialized initial state',
    (name, entry) => {
      if (UNREACHABLE_STORE_NAMES.includes(name)) return;
      const state = statesByStoreName.get(entry.name);
      // Through JSON, as `createJSONStorage` will: this is where a Map, Set,
      // Date, or `undefined` value silently changes shape before the schema
      // ever sees it.
      const persisted = JSON.parse(JSON.stringify(entry.partialize(state as never))) as unknown;
      const result = entry.schema.safeParse(persisted);
      // Surface the offending paths — a bare `false` here is useless at 3am.
      const issues = result.success
        ? []
        : result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.code}`);
      expect(issues).toEqual([]);
    }
  );
});
