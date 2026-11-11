/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * One cold start of the current app over a release fixture's disk, shared by
 * the release-fixture runner (`../releaseFixtures.test.ts`) and the tests that
 * start the app over a variant of a fixture.
 *
 * Importing this file mocks AsyncStorage, SecureStore and the file system
 * with in-memory maps (and the logger's file transport). Import it before
 * anything that loads those modules. `launch` resets the module registry, so
 * every app module it uses is required inside it.
 */
import { cacheFilePath } from './format';
import type { ReleaseFixture, SurvivingFact } from './format';

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

export type Disk = {
  asyncStorage: Record<string, string>;
  secureStore: Record<string, string>;
  files: Record<string, string>;
};

export interface Launch {
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

/** What the last launch had turned down when it stopped, if it threw. */
export const rejectionsOfLastLaunchSoFar = (): string[] => [...rejectionsOfLastLaunch];

/** Events that say a saved blob was turned down or a save did not land. */
const REJECTION =
  /\.(merge_rejected|rehydrate_failed|unreadable_preserved|write_refused|save_failed|preserve_failed)$|^migrations\.global\.failed$/;

/** What is on the in-memory disk now. */
export const snapshot = (): Disk => ({
  asyncStorage: Object.fromEntries([...mockAsync].sort()),
  secureStore: Object.fromEntries([...mockSecure].sort()),
  files: Object.fromEntries([...mockFiles].sort()),
});

/** A disk with each JSON value parsed: the order of an object's keys is not data. */
export function contents(disk: Disk): Record<string, Record<string, unknown>> {
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
  return {
    asyncStorage: parsed(disk.asyncStorage),
    secureStore: parsed(disk.secureStore),
    files: parsed(disk.files),
  };
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
  const rows = keys.filter((key) => key in fixture.asyncStorage);
  if (store.scope !== 'profile' && fixture.files && cacheFilePath(store.name) in fixture.files) {
    rows.push(cacheFilePath(store.name));
  }
  return rows;
}

/** The saved state under one fixture key or file path, as JSON text. */
function savedState(fixture: ReleaseFixture, key: string): string | undefined {
  const value = fixture.asyncStorage[key] ?? fixture.files?.[key];
  try {
    const row: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (typeof row !== 'object' || row === null || !('state' in row)) return undefined;
    return JSON.stringify(row.state);
  } catch {
    return undefined;
  }
}

/**
 * Start the current app over whatever is on the in-memory disk, in the order
 * the app does, in a fresh module registry (a cold start).
 */
export async function launch(fixture: ReleaseFixture): Promise<Launch> {
  jest.resetModules();
  // The setup file patches expo-asset for bundled images; a fresh registry needs it again.
  require('../../jest.staticAssets.js');

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

  const { migrateThenLoad } =
    require('@/shared/lib/migrations/migrateThenLoad') as typeof import('@/shared/lib/migrations/migrateThenLoad');
  const { whenLoaded } =
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
  const { ensureMnemonicExists, retrieveMnemonic } =
    require('@/shared/lib/nostr/secureStorage') as typeof import('@/shared/lib/nostr/secureStorage');
  const { loadAccountKeys } =
    require('@/shared/lib/nostr/loadAccountKeys') as typeof import('@/shared/lib/nostr/loadAccountKeys');
  const { runDataMigrations } =
    require('@/shared/lib/migrations/dataMigrations') as typeof import('@/shared/lib/migrations/dataMigrations');
  const { useSecureStoreState } =
    require('@/shared/stores/runtime/secureStoreState') as typeof import('@/shared/stores/runtime/secureStoreState');

  // 1. `GlobalMigrationGate`: migrate, load the three required stores, open
  //    per-account storage (shared/blocks/GlobalMigrationGate.tsx).
  await withTimeout('global migrations and required stores', migrateThenLoad());
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
        whenLoaded(entry.store as unknown as Parameters<typeof whenLoaded>[0], { orFailed: true })
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
        const rows = rowsReadFor(fixture, entry, account);
        if (rows.length === 0) continue;
        const project = entry.partialize as (state: unknown) => unknown;
        const now = JSON.stringify(project(entry.store.getState()));
        const defaults = JSON.stringify(project(entry.store.getInitialState()));
        // A row that held exactly the defaults had nothing to lose.
        if (now === defaults && !rows.every((key) => savedState(fixture, key) === defaults)) {
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

export function install(fixture: ReleaseFixture): void {
  mockAsync.clear();
  mockSecure.clear();
  mockFiles.clear();
  for (const [key, value] of Object.entries(fixture.asyncStorage)) {
    mockAsync.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const [key, value] of Object.entries(fixture.secureStore)) mockSecure.set(key, value);
  for (const [path, value] of Object.entries(fixture.files ?? {})) mockFiles.set(path, value);
}
