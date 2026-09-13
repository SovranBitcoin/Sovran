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
  '@/shared/stores/global/ctaStore',
  '@/shared/stores/global/wallpaperStore',
  '@/shared/stores/profile/dataMigrationStore',
  '@/shared/stores/profile/dmLastMessageStore',
  '@/shared/stores/profile/mintDistributionStore',
  '@/shared/stores/profile/mintStore',
  '@/shared/stores/profile/nostrSocialStore',
  '@/shared/stores/profile/npcMintStore',
  '@/shared/stores/profile/nutDropRedeemQueueStore',
  '@/shared/stores/profile/ownContentStore',
  '@/shared/stores/profile/ownProfileMetadataStore',
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
const NOT_A_CONCRETE_STORE = [
  'shared/lib/cache/createQueryCacheStore.ts',
  'shared/stores/profile/vertexBudgetStore.ts', // captured-owner factory, registered below
];

/**
 * Registered stores whose Zustand store object is not exported, so the test
 * cannot reach their initial state to round-trip it. Keep this list empty
 * where possible — an entry here is a real coverage gap, not a waiver.
 */
const UNREACHABLE_STORE_NAMES: string[] = [];

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
const { createVertexBudgetStore } = require('@/shared/stores/profile/vertexBudgetStore');
const vertexBudget = createVertexBudgetStore('a'.repeat(64));
statesByStoreName.set(vertexBudget.persist.getOptions().name, vertexBudget.getState());

for (const path of STORE_MODULES) {
  const mod = require(path) as Record<string, unknown>;
  for (const value of Object.values(mod)) {
    if (!isPersistedStore(value)) continue;
    const name = value.persist.getOptions().name;
    if (name) statesByStoreName.set(name, value.getState());
  }
}

describe('persisted store round-trip', () => {
  it('round-trips the all-word backup revision and CTA dismissal revisions', () => {
    const { useWalletLifecycleStore } = require('@/shared/stores/global/walletLifecycleStore');
    const { useCtaStore } = require('@/shared/stores/global/ctaStore');
    useWalletLifecycleStore.getState().markRecoveryPhraseVerified();
    useCtaStore.getState().dismiss('backup-recovery-phrase', true);
    for (const store of [useWalletLifecycleStore, useCtaStore]) {
      const options = store.persist.getOptions();
      const persisted = JSON.parse(JSON.stringify(options.partialize(store.getState())));
      expect(options.merge(persisted, store.getInitialState())).toMatchObject(persisted);
    }
    expect(useWalletLifecycleStore.getState().recoveryPhraseVerifiedRevision).toBe(2);
    expect(useCtaStore.getState().dismissed['backup-recovery-phrase'].revision).toBe(2);
  });

  it.each([
    {},
    {
      uptime24h: 0,
      avgLatencyMs: 0,
      auditSource: 'ucash',
      auditUpdatedAt: 123,
    },
    {
      uptime24h: 99.5,
      avgLatencyMs: 250,
      auditSource: '8333',
      auditUpdatedAt: '2026-09-13T00:00:00Z',
    },
  ])('round-trips optional discovery audit metrics %j alongside legacy data', (metrics) => {
    const { useMintMetadataStore } =
      require('@/shared/stores/global/mintMetadataStore') as typeof import('@/shared/stores/global/mintMetadataStore');
    const entry = { displayName: 'Mint', auditScore: 0, auditData: { swaps: [] }, ...metrics };
    const state = { byMintUrl: { 'https://mint.example': entry }, legacyMigrated: true };
    const options = useMintMetadataStore.persist.getOptions();
    const schema = persistRegistry.find((item) => item.name === 'mint-metadata-store')!.schema;
    const parsed = schema.parse(JSON.parse(JSON.stringify(state)));
    expect(options.merge!(parsed, useMintMetadataStore.getInitialState())).toMatchObject(state);
  });

  it('contains malformed new discovery metrics to their fields during hydration', () => {
    const { useMintMetadataStore } =
      require('@/shared/stores/global/mintMetadataStore') as typeof import('@/shared/stores/global/mintMetadataStore');
    const merged = useMintMetadataStore.persist.getOptions().merge!(
      {
        legacyMigrated: true,
        byMintUrl: {
          'https://mint.example': {
            displayName: 'Retained',
            uptime24h: 'invalid',
            avgLatencyMs: {},
            auditUpdatedAt: [],
          },
        },
      },
      useMintMetadataStore.getInitialState()
    );
    expect(merged.byMintUrl['https://mint.example']).toEqual({ displayName: 'Retained' });
    expect(merged.legacyMigrated).toBe(true);
  });

  it('round-trips a verified profile source repair without losing metadata', () => {
    const { useProfileStore } =
      require('@/shared/stores/global/profileStore') as typeof import('@/shared/stores/global/profileStore');
    const original = useProfileStore.getState();
    useProfileStore.setState({
      activeAccountIndex: 7,
      profiles: [
        {
          accountIndex: 7,
          pubkey: 'a'.repeat(64),
          source: 'imported',
          externalChain: 1,
          addedAt: 123,
          cachedBalanceSats: 42,
        },
      ],
    });
    expect(useProfileStore.getState().repairDerivedSource(7, 'a'.repeat(64))).toBe(true);
    const options = useProfileStore.persist.getOptions();
    const persisted = JSON.parse(JSON.stringify(options.partialize!(useProfileStore.getState())));
    expect(options.merge!(persisted, useProfileStore.getInitialState())).toMatchObject({
      activeAccountIndex: 7,
      profiles: [
        {
          accountIndex: 7,
          pubkey: 'a'.repeat(64),
          source: 'derived',
          externalChain: 0,
          addedAt: 123,
          cachedBalanceSats: 42,
        },
      ],
    });
    useProfileStore.setState(original);
  });

  it.each([
    {},
    { bolt12: true },
    { onchain: true, creq: false },
    { onchain: true, bolt12: true, creq: true },
  ])('round-trips Unified exclusions %j without losing mint preferences', (bip321ExcludedRails) => {
    const { useMintStore } =
      require('@/shared/stores/profile/mintStore') as typeof import('@/shared/stores/profile/mintStore');
    const state = {
      ...useMintStore.getInitialState(),
      selectedMint: 'https://mint.example',
      activeUnit: 'usd' as const,
      creqP2pkLock: true,
      creqExcludedMints: { 'https://other.example': true },
      bip321ExcludedRails,
    };
    const options = useMintStore.persist.getOptions();
    const persisted = JSON.parse(JSON.stringify(options.partialize!(state)));
    expect(persisted.bip321ExcludedRails).toEqual(bip321ExcludedRails);
    const hydrated = options.merge!(persisted, useMintStore.getInitialState());
    expect(hydrated).toMatchObject({
      selectedMint: state.selectedMint,
      activeUnit: 'usd',
      creqP2pkLock: true,
      creqExcludedMints: state.creqExcludedMints,
      bip321ExcludedRails,
    });
    expect(hydrated.setBip321RailExcluded).toBe(state.setBip321RailExcluded);
    expect(persisted.setBip321RailExcluded).toBeUndefined();
  });

  it.each([undefined, null, 'invalid', { bolt12: 'yes' }])(
    'contains missing or malformed Unified exclusions %j to their field',
    (bip321ExcludedRails) => {
      const { useMintStore } =
        require('@/shared/stores/profile/mintStore') as typeof import('@/shared/stores/profile/mintStore');
      const hydrated = useMintStore.persist.getOptions().merge!(
        { selectedMint: 'https://mint.example', creqP2pkLock: true, bip321ExcludedRails },
        useMintStore.getInitialState()
      );
      expect(hydrated).toMatchObject({
        selectedMint: 'https://mint.example',
        creqP2pkLock: true,
        bip321ExcludedRails: {},
      });
    }
  );

  it('updates and resets Unified exclusions atomically without clearing unavailable rails', () => {
    const { useMintStore } =
      require('@/shared/stores/profile/mintStore') as typeof import('@/shared/stores/profile/mintStore');
    const original = useMintStore.getState();
    try {
      useMintStore.setState({ bip321ExcludedRails: {} });
      original.setBip321RailExcluded('onchain', true);
      original.setBip321RailExcluded('bolt12', true);
      original.setBip321RailExcluded('creq', true);
      original.resetBip321RailExclusions(['onchain', 'creq']);
      expect(useMintStore.getState().bip321ExcludedRails).toEqual({ bolt12: true });
      original.setBip321RailExcluded('bolt12', false);
      expect(useMintStore.getState().bip321ExcludedRails).toEqual({});
    } finally {
      useMintStore.setState(original);
    }
  });

  it('round-trips prices and server time without persisting transient state', () => {
    const { usePricelistStore } =
      require('@/shared/stores/global/pricelistStore') as typeof import('@/shared/stores/global/pricelistStore');
    const state = {
      ...usePricelistStore.getState(),
      pricelist: { usd: { btc: 77_242 }, eur: { btc: 67_000 } },
      lastUpdated: 1_800_000_060_000,
      serverUpdatedAt: 1_800_000_000,
      isLoading: true,
      error: 'offline',
    };
    const options = usePricelistStore.persist.getOptions();
    const persisted = JSON.parse(JSON.stringify(options.partialize!(state)));
    expect(persisted).toEqual({
      pricelist: state.pricelist,
      lastUpdated: state.lastUpdated,
      serverUpdatedAt: state.serverUpdatedAt,
    });
    expect(options.merge!(persisted, usePricelistStore.getInitialState())).toMatchObject({
      ...persisted,
      isLoading: false,
      error: null,
    });
  });

  it.each([undefined, null, -1, 'invalid', 1.5])(
    'hydrates legacy prices with serverUpdatedAt=%s without discarding the cache',
    (serverUpdatedAt) => {
      const { usePricelistStore } =
        require('@/shared/stores/global/pricelistStore') as typeof import('@/shared/stores/global/pricelistStore');
      const legacy = JSON.parse(
        JSON.stringify({
          pricelist: { usd: { btc: 77_242 }, gbp: { btc: 58_000 } },
          lastUpdated: 1_800_000_000_000,
          serverUpdatedAt,
        })
      );
      const hydrated = usePricelistStore.persist.getOptions().merge!(
        legacy,
        usePricelistStore.getInitialState()
      );
      expect(hydrated).toMatchObject({
        pricelist: legacy.pricelist,
        lastUpdated: legacy.lastUpdated,
        serverUpdatedAt: null,
      });
      expect(hydrated.setBtcPrices).toBe(usePricelistStore.getState().setBtcPrices);
    }
  );

  it('round-trips populated app version metadata through the settings projection', () => {
    const entry = persistRegistry.find((store) => store.name === 'settings-store')!;
    const lastKnownAppVersion = {
      version: '0.1.3',
      minVersion: '0.1.2',
      message: 'Please update',
      fetchedAt: 123,
    };
    const { useSettingsStore } =
      require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore');
    const state = { ...useSettingsStore.getState(), lastKnownAppVersion };
    const persisted = JSON.parse(
      JSON.stringify(useSettingsStore.persist.getOptions().partialize!(state))
    );
    expect(persisted.lastKnownAppVersion).toEqual(lastKnownAppVersion);
    expect(entry.schema.parse(persisted)).toMatchObject({ lastKnownAppVersion });
  });

  it('round-trips Routstr auth and the last working node with its server timestamp', () => {
    const { useRoutstrStore } =
      require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
    const { emptyLineup } =
      require('@/shared/lib/routstr/lineup') as typeof import('@/shared/lib/routstr/lineup');
    const entry = persistRegistry.find((store) => store.name === 'routstr-store')!;
    const lastKnownLineup = {
      derivedAt: 123,
      lineup: emptyLineup(),
      nodeBaseUrl: 'https://working.example',
    };
    const state = {
      ...useRoutstrStore.getState(),
      authMode: 'x-cashu' as const,
      serverLineupAt: 123,
      lastKnownLineup,
    };
    const persisted = JSON.parse(
      JSON.stringify(useRoutstrStore.persist.getOptions().partialize!(state))
    );
    expect(entry.schema.parse(persisted)).toMatchObject({
      authMode: 'x-cashu',
      serverLineupAt: 123,
      lastKnownLineup,
    });
  });

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

describe('mint preference persistence', () => {
  const { useMintStore } =
    require('@/shared/stores/profile/mintStore') as typeof import('@/shared/stores/profile/mintStore');
  const options = useMintStore.persist.getOptions();
  it('drops the retired creqMintsPreferred key without losing other fields', () => {
    const persisted = {
      selectedMint: 'https://mint.example',
      activeUnit: 'usd',
      creqP2pkLock: true,
      creqExcludedMints: { 'https://other.example': true },
      standingQuotes: { 'creq|usd': 'op-1' },
      creqMintsPreferred: true,
    };
    const merged = options.merge!(persisted, useMintStore.getInitialState()) as unknown as Record<
      string,
      unknown
    >;
    expect(merged).toMatchObject({
      selectedMint: 'https://mint.example',
      activeUnit: 'usd',
      creqP2pkLock: true,
      creqExcludedMints: { 'https://other.example': true },
      standingQuotes: { 'creq|usd': 'op-1' },
    });
    expect(merged.creqMintsPreferred).toBeUndefined();
  });
});
