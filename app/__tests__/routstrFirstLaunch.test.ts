/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * The Routstr store on a launch that starts with no account.
 *
 * A new install, and an install from before accounts existed (0.0.1 to
 * 0.0.56), have no `profile-store` when the store module is evaluated. The
 * keys provider adds account 0 seconds later. The store files everything
 * under the account, key vault included, so it has to load once the account
 * exists and must write nothing before. These run the real store, adapter,
 * vault, scoped storage and migrations over in-memory storage.
 */
import { ACCOUNTS, PHRASE } from './releaseFixtures/format';

const mockAsync = new Map<string, string>();
const mockSecure = new Map<string, string>();
/** Reads of these keys wait for their promise: a slow disk. */
const mockReadHeld = new Map<string, Promise<void>>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => {
      await mockReadHeld.get(key);
      return mockAsync.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
    getAllKeys: async () => [...mockAsync.keys()],
  };
  return { __esModule: true, default: storage, ...storage };
});
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock('@/shared/lib/loggerFile', () => ({
  applyFileLogging: () => {},
  exportLogFile: async () => null,
  clearLogFile: () => {},
  getLogFileInfo: () => null,
}));

// The first cold start compiles the whole store graph.
jest.setTimeout(60_000);

const OWNER = ACCOUNTS[0].pubkey;
const OWN_KEY = `routstr-store:profile:${OWNER}`;
const FUNDED_KEY = 'sk-funded-fixture';

/** The blob 0.0.51 to 0.0.56 wrote under the bare name: version 0, the key in plain text. */
const PRE_ACCOUNT_BLOB = JSON.stringify({
  state: {
    apiKey: FUNDED_KEY,
    balance: 21_000,
    selectedModel: 'gpt-4o',
    sessions: [{ id: 'session-1700000000000', title: 'Chat', createdAt: 1, messages: [] }],
    currentSessionId: 'session-1700000000000',
  },
  version: 0,
});

/** Saves are not awaited by zustand; every double here settles on microtasks. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** A cold start up to the point where storage opens, with no keys loaded yet. */
async function coldStart() {
  jest.resetModules();
  const problems: string[] = [];
  const logger = require('@/shared/lib/logger') as Record<
    string,
    Record<'warn' | 'error', (event: string) => void>
  >;
  for (const channel of ['log', 'storeLog', 'aiLog']) {
    for (const level of ['warn', 'error'] as const) {
      jest.spyOn(logger[channel], level).mockImplementation((event) => {
        problems.push(String(event));
      });
    }
  }
  const { useRoutstrStore } =
    require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
  const { runGlobalMigrations } =
    require('@/shared/lib/migrations/globalMigrations') as typeof import('@/shared/lib/migrations/globalMigrations');
  const { signalMigrationsComplete } =
    require('@/shared/lib/cashu/profileScopedStorage') as typeof import('@/shared/lib/cashu/profileScopedStorage');
  const { hydrationSettled } =
    require('@/shared/lib/persist/hydrationOutcome') as typeof import('@/shared/lib/persist/hydrationOutcome');
  const { useProfileStore } =
    require('@/shared/stores/global/profileStore') as typeof import('@/shared/stores/global/profileStore');

  await runGlobalMigrations();
  signalMigrationsComplete();
  const loaded = await hydrationSettled(useRoutstrStore);
  await settle();
  return {
    store: useRoutstrStore,
    loaded,
    problems,
    /** What the keys provider does once it has derived account 0. */
    addAccountZero: async () => {
      useProfileStore.getState().addProfile(0, OWNER);
      await settle();
    },
  };
}

const routstrKeys = () => [...mockAsync.keys()].filter((key) => key.startsWith('routstr-store'));
const vaultText = () => [...mockSecure.values()].join('');

/** Hold the account's Routstr read until the returned function is called. */
function holdAccountRead(): () => void {
  let release = () => {};
  mockReadHeld.set(OWN_KEY, new Promise<void>((resolve) => (release = resolve)));
  return () => {
    mockReadHeld.delete(OWN_KEY);
    release();
  };
}

beforeEach(() => {
  mockAsync.clear();
  mockSecure.clear();
  mockReadHeld.clear();
  // The logger prints every entry.
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});
afterEach(() => jest.restoreAllMocks());

describe('a new install', () => {
  it('loads with nothing stored and writes nothing before the account exists', async () => {
    const { store, loaded, problems } = await coldStart();
    expect(loaded).toBe(true);

    store.setState({ selectedModel: 'gpt-4o' });
    await settle();

    expect(routstrKeys()).toEqual([]);
    expect(mockSecure.size).toBe(0);
    expect(problems).toEqual([]);
  });

  it('saves under the account once it exists, with the key in the vault', async () => {
    const { store, problems, addAccountZero } = await coldStart();
    store.setState({ selectedModel: 'gpt-4o' });
    await addAccountZero();

    store.setState({ apiKey: FUNDED_KEY, balance: 7 });
    await settle();

    expect(routstrKeys()).toEqual([OWN_KEY]);
    const plain = mockAsync.get(OWN_KEY)!;
    expect(plain).not.toContain(FUNDED_KEY);
    // What was chosen before the account existed is carried by this save.
    expect(JSON.parse(plain).state).toMatchObject({ selectedModel: 'gpt-4o', balance: 7 });
    expect(vaultText()).toContain(FUNDED_KEY);
    expect(problems).toEqual([]);

    const next = await coldStart();
    expect(next.store.getState().apiKey).toBe(FUNDED_KEY);
    expect(next.problems).toEqual([]);
  });
});

describe('an install from before accounts existed', () => {
  beforeEach(() => {
    mockAsync.set('routstr-store', PRE_ACCOUNT_BLOB);
    mockSecure.set('user_mnemonic', PHRASE);
  });

  it('loads its key and chats on the first launch, once account 0 has its row', async () => {
    const { store, loaded, problems, addAccountZero } = await coldStart();
    expect(loaded).toBe(true);
    // The migration copied the blob to the account's key; nothing has read it yet.
    expect(mockAsync.get(OWN_KEY)).toBe(PRE_ACCOUNT_BLOB);
    expect(store.getState().apiKey).toBeNull();

    await addAccountZero();

    expect(store.getState().apiKey).toBe(FUNDED_KEY);
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.persist.hasHydrated()).toBe(true);
    expect(problems).toEqual([]);
  });

  it('saves on the first launch, and keeps the key out of the plain copy', async () => {
    const { store, problems, addAccountZero } = await coldStart();
    await addAccountZero();

    store.getState().setBalance(20_000);
    await settle();

    const plain = mockAsync.get(OWN_KEY)!;
    expect(plain).not.toContain(FUNDED_KEY);
    expect(JSON.parse(plain).state.balance).toBe(20_000);
    expect(vaultText()).toContain(FUNDED_KEY);
    expect(problems).toEqual([]);
  });

  it('does not replace the stored copy with what it held before the account existed', async () => {
    const { store, problems } = await coldStart();

    // Any change made while there is still no account: a save of defaults.
    store.getState().setBalance(0);
    await settle();

    expect(mockAsync.get(OWN_KEY)).toBe(PRE_ACCOUNT_BLOB);
    expect(mockAsync.get('routstr-store')).toBe(PRE_ACCOUNT_BLOB);
    expect(mockSecure.has('user_mnemonic')).toBe(true);
    expect(vaultText()).not.toContain(FUNDED_KEY);
    expect(problems).toEqual([]);
  });
});

describe('a change made while the store is loading for the new account', () => {
  const NEW_KEY = 'sk-paid-during-load';
  const PAYMENT = {
    encoded: 'cashuBfixture',
    nodeBaseUrl: 'https://node.example',
    operationId: 'op-1',
    startedAt: 1,
  };

  it('saves a key paid for during the load once the load is accepted', async () => {
    const { store, problems, addAccountZero } = await coldStart();
    const finishRead = holdAccountRead();
    await addAccountZero();

    // The reload is waiting on its read. A save now cannot be written yet.
    store.setState({ apiKey: NEW_KEY, balance: 7 });
    await settle();
    expect(vaultText()).not.toContain(NEW_KEY);

    finishRead();
    await settle();

    expect(store.getState().apiKey).toBe(NEW_KEY);
    expect(vaultText()).toContain(NEW_KEY);
    expect(mockAsync.get(OWN_KEY)).not.toContain(NEW_KEY);
    expect(JSON.parse(mockAsync.get(OWN_KEY)!).state.balance).toBe(7);
    expect(problems).toEqual([]);

    const next = await coldStart();
    expect(next.store.getState().apiKey).toBe(NEW_KEY);
    expect(next.store.getState().balance).toBe(7);
  });

  it('keeps both keys when the stored blob already has one: stored stays live, the new one is archived', async () => {
    mockAsync.set('routstr-store', PRE_ACCOUNT_BLOB);
    mockSecure.set('user_mnemonic', PHRASE);
    const { store, problems, addAccountZero } = await coldStart();
    const finishRead = holdAccountRead();
    await addAccountZero();

    store.setState({
      apiKey: NEW_KEY,
      balance: 7,
      nodeBaseUrl: 'https://node.example',
      pendingPayments: { 'op-1': PAYMENT },
    });
    finishRead();
    await settle();

    const held = (state: ReturnType<typeof store.getState>) => ({
      live: state.apiKey,
      balance: state.balance,
      sessions: state.sessions.length,
      archived: Object.values(state.legacyAccounts)
        .map((account) => account.apiKey)
        .sort(),
      pending: Object.keys(state.pendingPayments),
    });
    const expected = {
      live: FUNDED_KEY,
      balance: 21_000,
      sessions: 1,
      archived: [FUNDED_KEY, NEW_KEY].sort(),
      pending: ['op-1'],
    };
    expect(held(store.getState())).toEqual(expected);
    expect(problems).toEqual([]);

    // Saved without waiting for a later change, and out of the plain copy.
    expect(vaultText()).toContain(NEW_KEY);
    expect(mockAsync.get(OWN_KEY)).not.toContain(NEW_KEY);
    expect(mockAsync.get(OWN_KEY)).not.toContain(PAYMENT.encoded);
    const next = await coldStart();
    expect(held(next.store.getState())).toEqual(expected);
  });

  it('writes nothing when the load is turned down, as before', async () => {
    // A blob the schema cannot accept: a session without an id.
    mockAsync.set(OWN_KEY, JSON.stringify({ state: { sessions: [{ title: 1 }] }, version: 3 }));
    const stored = mockAsync.get(OWN_KEY);
    const { store, addAccountZero } = await coldStart();
    const finishRead = holdAccountRead();
    await addAccountZero();

    store.setState({ apiKey: NEW_KEY });
    finishRead();
    await settle();

    expect(mockAsync.get(OWN_KEY)).toBe(stored);
    expect(mockSecure.size).toBe(0);
  });
});
