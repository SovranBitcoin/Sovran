/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Every release epoch, upgraded straight to this build.
 *
 * Each fixture in `releaseFixtures/` is the disk of a used install of one
 * epoch. It is loaded into in-memory AsyncStorage and SecureStore and the
 * current app is started over it three times: the global migrations, the
 * stores the app cannot start without, every persisted store through its real
 * persist options and scoped storage, the keys of every account, and an
 * account switch to read each account's own copies.
 *
 * What Jest cannot do is left to a device: opening the SQLite databases,
 * rendering, and the native keychain. See `releaseFixtures/README.md`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils.js';

import { ACCOUNTS, NAMED_CHECKS, PHRASE } from './releaseFixtures/format';
import type { ReleaseFixture, SurvivingFact } from './releaseFixtures/format';
import { RELEASE_FIXTURES } from './releaseFixtures';

const mockAsync = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockFiles = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
    getAllKeys: async () => [...mockAsync.keys()],
    multiGet: async (keys: string[]) => keys.map((key) => [key, mockAsync.get(key) ?? null]),
    multiSet: async (pairs: [string, string][]) =>
      pairs.forEach(([key, value]) => mockAsync.set(key, value)),
    multiRemove: async (keys: string[]) => keys.forEach((key) => mockAsync.delete(key)),
    clear: async () => mockAsync.clear(),
  };
  return { __esModule: true, default: storage, ...storage };
});
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
// `btcmap-store` keeps its cache in a file and adopts the row an earlier release left.
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'cache/',
  documentDirectory: 'document/',
  getInfoAsync: async (path: string) => ({ exists: mockFiles.has(path) }),
  readAsStringAsync: async (path: string) => {
    const value = mockFiles.get(path);
    if (value === undefined) throw new Error(`no such file: ${path}`);
    return value;
  },
  writeAsStringAsync: async (path: string, value: string) => void mockFiles.set(path, value),
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const value = mockFiles.get(from);
    if (value === undefined) throw new Error(`no such file: ${from}`);
    mockFiles.set(to, value);
    mockFiles.delete(from);
  },
  deleteAsync: async (path: string) => void mockFiles.delete(path),
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [],
}));

// The file transport of the logger needs the native file system; it holds logs, not user data.
jest.mock('@/shared/lib/loggerFile', () => ({
  applyFileLogging: () => {},
  exportLogFile: async () => null,
  clearLogFile: () => {},
  getLogFileInfo: () => null,
}));

// ── One launch ───────────────────────────────────────────────────────────────

type Disk = { asyncStorage: Record<string, string>; secureStore: Record<string, string> };

interface Launch {
  /** Stores whose saved data could not be read. */
  unreadStores: string[];
  /** Warnings and errors that mean a saved blob was turned down, or a save was. */
  rejections: string[];
  secureStoreState: string;
  /** The public key the current app opens for each account, by account index. */
  openedPubkeys: Record<number, string | undefined>;
  activeAccountIndex: number;
  /** The value found at each fact's path, by `what`. */
  facts: Record<string, unknown>;
  /** Rows the current app reads that came back as the store's defaults: `<store> (account <n>)`. */
  defaultedRows: string[];
  disk: Disk;
}

/** Kept outside `launch` so a launch that throws can still say what was turned down. */
let rejectionsOfLastLaunch: string[] = [];

/** Events that say a saved blob was turned down or a save did not land. */
const REJECTION =
  /\.(merge_rejected|rehydrate_failed|unreadable_preserved|write_refused|save_failed|preserve_failed)$|^migrations\.global\.failed$/;

const snapshot = (): Disk => ({
  asyncStorage: Object.fromEntries([...mockAsync].sort()),
  secureStore: Object.fromEntries([...mockSecure].sort()),
});

/** A disk with each JSON value parsed: the order of an object's keys is not data. */
function contents(disk: Disk): Record<string, Record<string, unknown>> {
  const parsed = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        try {
          return [key, JSON.parse(value) as unknown];
        } catch {
          return [key, value];
        }
      })
    );
  return { asyncStorage: parsed(disk.asyncStorage), secureStore: parsed(disk.secureStore) };
}

/** Saves are not awaited by zustand; every double here settles on microtasks. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn++) await new Promise((resolve) => setImmediate(resolve));
}

function withTimeout<T>(what: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} did not finish`)), 10_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

const read = (state: unknown, path: SurvivingFact['path']): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined,
    state
  );

/** The fixture rows the current app reads for one account of one store. */
function rowsReadFor(
  fixture: ReleaseFixture,
  store: { name: string; scope?: string },
  account: ReleaseFixture['survives']['accounts'][number]
): string[] {
  const keys =
    store.scope === 'profile'
      ? [
          `${store.name}:profile:${account.pubkey}`,
          // 0.0.58 to 0.0.61 keyed the other accounts by index; before that, and
          // for account 0 until 0.0.62, the bare key.
          `${store.name}:profile:${account.accountIndex}`,
          ...(account.accountIndex === 0 ? [store.name] : []),
        ]
      : [store.name];
  return keys.filter((key) => key in fixture.asyncStorage);
}

/**
 * Start the current app over whatever is on the in-memory disk, in the order
 * the app does, in a fresh module registry (a cold start).
 */
async function launch(fixture: ReleaseFixture): Promise<Launch> {
  jest.resetModules();
  // The setup file patches expo-asset for bundled images; a fresh registry needs it again.
  require('../jest.staticAssets.js');

  const rejections: string[] = [];
  rejectionsOfLastLaunch = rejections;
  const logger = require('@/shared/lib/logger') as Record<
    string,
    Record<'warn' | 'error', (event: string, params?: { error?: unknown }) => void>
  >;
  for (const channel of ['log', 'storeLog', 'nostrLog', 'aiLog']) {
    for (const level of ['warn', 'error'] as const) {
      jest.spyOn(logger[channel], level).mockImplementation((event, params) => {
        if (!REJECTION.test(String(event))) return;
        const cause = params?.error ? `: ${JSON.stringify(params.error)}` : '';
        rejections.push(`${event}${cause}`);
      });
    }
  }

  // The bundle evaluates every store module; so does a launch here. The list
  // comes from the generated registry, so a new store joins without an edit.
  const { storeRegistryManifest } =
    require('@/shared/lib/persist/storeRegistryManifest') as typeof import('@/shared/lib/persist/storeRegistryManifest');
  const storeFiles = storeRegistryManifest.filter((e) => e.persisted).map((e) => e.file);
  for (const file of new Set(storeFiles)) require(`@/${file.replace(/\.tsx?$/, '')}`);

  const { runGlobalMigrations } =
    require('@/shared/lib/migrations/globalMigrations') as typeof import('@/shared/lib/migrations/globalMigrations');
  const { hydrationSettled, loadRequiredStores } =
    require('@/shared/lib/persist/hydrationOutcome') as typeof import('@/shared/lib/persist/hydrationOutcome');
  const { signalMigrationsComplete } =
    require('@/shared/lib/cashu/profileScopedStorage') as typeof import('@/shared/lib/cashu/profileScopedStorage');
  const { persistRegistry } =
    require('@/shared/lib/persist/persistConfig') as typeof import('@/shared/lib/persist/persistConfig');
  const { liveStores, registerProfileSwitchBoundary } =
    require('@/shared/lib/account/accountRegistry') as typeof import('@/shared/lib/account/accountRegistry');
  const { runInProcessProfileSwitch } =
    require('@/shared/lib/profile/inProcessProfileSwitch') as typeof import('@/shared/lib/profile/inProcessProfileSwitch');
  const { useProfileStore } =
    require('@/shared/stores/global/profileStore') as typeof import('@/shared/stores/global/profileStore');
  const { useSettingsStore } =
    require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore');
  const { useWalletLifecycleStore } =
    require('@/shared/stores/global/walletLifecycleStore') as typeof import('@/shared/stores/global/walletLifecycleStore');
  const { ensureMnemonicExists, retrieveMnemonic } =
    require('@/shared/lib/nostr/secureStorage') as typeof import('@/shared/lib/nostr/secureStorage');
  const { loadAccountKeys } =
    require('@/shared/lib/nostr/loadAccountKeys') as typeof import('@/shared/lib/nostr/loadAccountKeys');
  const { runDataMigrations } =
    require('@/shared/lib/migrations/dataMigrations') as typeof import('@/shared/lib/migrations/dataMigrations');
  const { useSecureStoreState } =
    require('@/shared/stores/runtime/secureStoreState') as typeof import('@/shared/stores/runtime/secureStoreState');

  // 1. `GlobalMigrationGate`: migrate, load the three required stores, open
  //    per-account storage (shared/blocks/GlobalMigrationGate.tsx, migrateThenLoad).
  await withTimeout('global migrations', runGlobalMigrations());
  await withTimeout(
    'required stores',
    loadRequiredStores([useProfileStore, useSettingsStore, useWalletLifecycleStore])
  );
  signalMigrationsComplete();

  // 2. Every persisted store finishes reading its saved data.
  const persisted = persistRegistry.flatMap((entry) =>
    entry.store?.persist ? [{ ...entry, store: entry.store, persist: entry.store.persist }] : []
  );
  const unreadStores: string[] = [];
  const loadAll = async () => {
    unreadStores.length = 0;
    for (const entry of persisted) {
      const loaded = await withTimeout(
        `${entry.name} hydration`,
        hydrationSettled(entry.store as unknown as Parameters<typeof hydrationSettled>[0])
      );
      if (!loaded) unreadStores.push(entry.name);
    }
  };
  await loadAll();

  // 3. `NostrKeysProvider.initializeKeys`: the stored phrase, or the one this
  //    build adopts or makes; the active account's keys; its row in the list.
  const openedPubkeys: Launch['openedPubkeys'] = {};
  const openAccount = async (accountIndex: number) => {
    const phrase = (await retrieveMnemonic()) ?? (await ensureMnemonicExists());
    if (!phrase) throw new Error('Startup stopped on key recovery: no phrase could be read');
    const loaded = await loadAccountKeys({
      mnemonic: phrase,
      accountIndex,
      onProgress: () => {},
      shouldContinue: () => true,
    });
    const pubkey = loaded?.keys?.pubkey;
    if (pubkey && !loaded.isImported) useProfileStore.getState().addProfile(accountIndex, pubkey);
    openedPubkeys[accountIndex] = pubkey;
    // `ColadaProvider` mounts under the keys and moves the account's older
    // side data into annotations (features/send/providers/Colada.tsx).
    await withTimeout('data migrations', runDataMigrations());
  };
  const activeAccountIndex = useProfileStore.getState().activeAccountIndex;
  await openAccount(activeAccountIndex);
  await settle();

  // 4. Use: one write from every store, as any first interaction causes. A
  //    store that loaded defaults over data it could not read shows here.
  const writeFromEveryStore = async () => {
    for (const entry of persisted) (entry.store.setState as (partial: object) => void)({});
    await settle();
  };
  await writeFromEveryStore();

  const facts: Launch['facts'] = {};
  const defaultedRows: string[] = [];
  const observe = (accountIndex: number) => {
    const account = fixture.survives.accounts.find((a) => a.accountIndex === accountIndex);
    for (const fact of fixture.survives.facts) {
      const live = liveStores.find((entry) => entry.name === fact.store && entry.persisted);
      const mine =
        live?.scope !== 'profile' || (fact.accountIndex ?? activeAccountIndex) === accountIndex;
      if (mine && !(fact.what in facts)) facts[fact.what] = read(live?.store.getState(), fact.path);
    }
    if (!account) return;
    for (const entry of persisted) {
      if (entry.scope === 'profile' || accountIndex === activeAccountIndex) {
        if (fixture.defaultRows.includes(entry.name)) continue;
        if (rowsReadFor(fixture, entry, account).length === 0) continue;
        const project = entry.partialize as (state: unknown) => unknown;
        const now = JSON.stringify(project(entry.store.getState()));
        if (now === JSON.stringify(project(entry.store.getInitialState()))) {
          defaultedRows.push(`${entry.name} (account ${accountIndex})`);
        }
      }
    }
  };
  observe(activeAccountIndex);

  // 5. Every other account, through the app's own switch, then back.
  const stopBoundary = registerProfileSwitchBoundary({
    suspend: async () => {},
    resume: async () => {},
  });
  const switchTo = async (accountIndex: number) => {
    await runInProcessProfileSwitch({
      cleanupCoco: async () => {},
      flipAccount: () => {
        if (!useProfileStore.getState().switchProfile(accountIndex)) {
          throw new Error(`account ${accountIndex} is not in the account list`);
        }
      },
    });
    await loadAll();
    await openAccount(accountIndex);
    await writeFromEveryStore();
  };
  const others = fixture.survives.accounts
    .map((account) => account.accountIndex)
    .filter((accountIndex) => accountIndex !== activeAccountIndex);
  for (const accountIndex of others) {
    await switchTo(accountIndex);
    observe(accountIndex);
  }
  if (others.length > 0) await switchTo(activeAccountIndex);
  stopBoundary();
  await settle();

  return {
    unreadStores,
    rejections,
    secureStoreState: useSecureStoreState.getState().secureStoreState,
    openedPubkeys,
    activeAccountIndex,
    facts,
    defaultedRows,
    disk: snapshot(),
  };
}

function install(fixture: ReleaseFixture): void {
  mockAsync.clear();
  mockSecure.clear();
  mockFiles.clear();
  for (const [key, value] of Object.entries(fixture.asyncStorage)) {
    mockAsync.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const [key, value] of Object.entries(fixture.secureStore)) mockSecure.set(key, value);
}

// ── The fixed identity ───────────────────────────────────────────────────────

it('uses account keys that match an independent NIP-06 derivation', () => {
  const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(PHRASE));
  ACCOUNTS.forEach((account, index) => {
    const child = root.derive(`m/44'/1237'/${index}'/0/0`);
    expect(bytesToHex(child.publicKey!.slice(1))).toBe(account.pubkey);
    expect(bytesToHex(child.privateKey!)).toBe(account.privateKeyHex);
  });
});

/**
 * `RELEASE_FIXTURE_FILE=E21-0.1.5 bun run test -- __tests__/releaseFixtures.test.ts`
 * runs one fixture file, listed in `index.ts` or not, while it is being written.
 */
const ONE_FILE = process.env.RELEASE_FIXTURE_FILE;
const FIXTURES: readonly ReleaseFixture[] = ONE_FILE
  ? [(require(`./releaseFixtures/${ONE_FILE}`) as { fixture: ReleaseFixture }).fixture]
  : RELEASE_FIXTURES;

// ── Every fixture ────────────────────────────────────────────────────────────

describe.each(
  FIXTURES.map((fixture) => [fixture.epoch, fixture.versions.join(', '), fixture] as const)
)('%s (%s) upgraded straight to this build', (_epoch, _versions, fixture) => {
  const { survives } = fixture;
  const gap = (what: string) => fixture.knownGaps.find((known) => known.what === what);
  /** `it`, or `it.failing` for an expectation the fixture records as a known gap. */
  const check = (what: string) => (gap(what) ? it.failing : it);
  const title = (what: string) => {
    const known = gap(what);
    return known ? `keeps ${what} [known gap ${known.followUp}: ${known.why}]` : `keeps ${what}`;
  };

  const launches: Launch[] = [];
  const quieted: jest.SpyInstance[] = [];
  let startupError: unknown;
  let startupRejections: string[] = [];

  beforeAll(async () => {
    // The logger prints every entry; a launch makes hundreds.
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      quieted.push(jest.spyOn(console, method).mockImplementation(() => {}));
    }
    install(fixture);
    try {
      // Three cold starts. An install from before accounts existed finishes
      // moving its stores on the second, once account 0 has its row.
      for (let n = 0; n < 3; n++) launches.push(await launch(fixture));
    } catch (error) {
      startupError = error;
      startupRejections = [...rejectionsOfLastLaunch];
    }
  }, 120_000);

  afterAll(() => quieted.forEach((spy) => spy.mockRestore()));

  // Known gap F99. An install with no account list has no key to file Routstr
  // under until the keys provider adds account 0, and nothing loads the store
  // again in that session: it stays unread and refuses to save until the next
  // launch. Everywhere below, exactly that is set aside for the first launch
  // of such an install, and the test after this comment pins it.
  const noAccountList = !('profile-store' in fixture.asyncStorage);
  const routstrWaits = (n: number) => noAccountList && n === 0;
  const unread = (each: Launch, n: number) =>
    each.unreadStores.filter((name) => !(routstrWaits(n) && name === 'routstr-store'));
  const rejected = (each: Launch, n: number) =>
    each.rejections.filter((event) => !(routstrWaits(n) && event.startsWith('store.routstr.')));

  if (noAccountList) {
    it.failing('loads the Routstr store on the first launch [known gap F99]', () => {
      expect(launches).toHaveLength(3);
      expect(launches[0].unreadStores).toEqual([]);
    });
  }

  it('starts, three times over, without stopping on a failure or recovery screen', () => {
    expect({ error: startupError, rejections: startupRejections }).toEqual({
      error: undefined,
      rejections: [],
    });
    expect(launches).toHaveLength(3);
    launches.forEach((each, n) => {
      expect(unread(each, n)).toEqual([]);
      expect(each.secureStoreState).toBe('available');
    });
  });

  it('keeps the phrase and makes no new one', () => {
    expect(survives.phrase).toBe(PHRASE);
    for (const each of launches) expect(each.disk.secureStore.user_mnemonic).toBe(survives.phrase);
  });

  it('opens every account with the key it had, and keeps the same account selected', () => {
    const expected = Object.fromEntries(survives.accounts.map((a) => [a.accountIndex, a.pubkey]));
    for (const each of launches) {
      expect(each.openedPubkeys).toEqual(expected);
      expect(each.activeAccountIndex).toBe(survives.activeAccountIndex);
      const saved = JSON.parse(each.disk.asyncStorage['profile-store']) as {
        state: { profiles: { accountIndex: number; pubkey: string }[] };
      };
      expect(
        Object.fromEntries(saved.state.profiles.map((p) => [p.accountIndex, p.pubkey]))
      ).toEqual(expected);
    }
  });

  if (survives.facts.length > 0) {
    for (const fact of survives.facts) {
      check(fact.what)(title(fact.what), () => {
        expect(launches).toHaveLength(3);
        launches.forEach((each, n) => {
          if (routstrWaits(n) && fact.store === 'routstr-store') return;
          expect(each.facts[fact.what]).toEqual(fact.equals);
        });
      });
    }
  }

  it('turns down no saved blob and sets none aside as unreadable', () => {
    expect(launches).toHaveLength(3);
    for (const [n, each] of launches.entries()) {
      expect(rejected(each, n)).toEqual([]);
      const keys = [...Object.keys(each.disk.asyncStorage), ...Object.keys(each.disk.secureStore)];
      expect(keys.filter((key) => key.includes(':unreadable'))).toEqual([]);
    }
  });

  it('loads no store that held data as its defaults', () => {
    expect(launches).toHaveLength(3);
    const accepted = fixture.knownGaps.map((known) => known.what);
    const lost = (each: Launch, n: number) =>
      each.defaultedRows.filter(
        (row) =>
          !accepted.some((what) => row.startsWith(`${what} `)) &&
          !(routstrWaits(n) && row.startsWith('routstr-store '))
      );
    launches.forEach((each, n) => expect(lost(each, n)).toEqual([]));
  });

  it('deletes nothing the fixture says must be kept', () => {
    expect(launches).toHaveLength(3);
    for (const each of launches) {
      for (const key of survives.keptAsyncStorage) {
        const was = fixture.asyncStorage[key];
        expect(each.disk.asyncStorage[key]).toBe(
          typeof was === 'string' ? was : JSON.stringify(was)
        );
      }
      for (const key of survives.keptSecureStore) {
        expect(each.disk.secureStore[key]).toBe(fixture.secureStore[key]);
      }
    }
  });

  it('changes nothing on a later launch', () => {
    expect(launches).toHaveLength(3);
    const [first, second, third] = launches;
    expect(contents(third.disk)).toEqual(contents(second.disk));
    // An install that already had its account list is finished after one launch.
    if ('profile-store' in fixture.asyncStorage)
      expect(contents(second.disk)).toEqual(contents(first.disk));
  });

  it('names only databases the current app opens for these accounts', () => {
    const manager = readFileSync(join(__dirname, '..', 'shared/lib/cashu/manager.ts'), 'utf8');
    expect(manager).toContain("accountIndex === 0 ? 'coco.db' : `coco-${accountIndex}.db`");
    const opened = survives.accounts.flatMap(({ accountIndex }) =>
      accountIndex === 0
        ? ['coco.db', 'nostr']
        : [`coco-${accountIndex}.db`, `nostr-${accountIndex}`]
    );
    for (const name of fixture.sqliteDatabases) expect(opened).toContain(name);
  });

  const { reduxEcash } = survives;
  if (reduxEcash) {
    check(NAMED_CHECKS.reduxProofs)(title(NAMED_CHECKS.reduxProofs), () => {
      const { readLegacyEcash } = require('wallet') as typeof import('wallet');
      const row = fixture.asyncStorage['persist:SOVRAN'];
      const found = readLegacyEcash(typeof row === 'string' ? row : JSON.stringify(row));
      expect(found.kind).toBe('read');
      if (found.kind !== 'read') return;
      const perMint = new Map<string, number>();
      for (const group of found.groups) {
        const amount = group.proofs.reduce((sum, proof) => sum + proof.amount, 0);
        perMint.set(group.mintUrl, (perMint.get(group.mintUrl) ?? 0) + amount);
      }
      expect({ skipped: found.skipped, perMint: Object.fromEntries(perMint) }).toEqual({
        skipped: 0,
        perMint: Object.fromEntries(reduxEcash.map((held) => [held.mintUrl, held.amount])),
      });
    });
  }
});
