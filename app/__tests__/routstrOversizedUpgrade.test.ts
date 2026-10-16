/**
 * Upgrading a Routstr store that an older release wrote past today's ceilings.
 *
 * Releases up to 0.1.0 saved every session and every message with no limit.
 * The schema turns down a list that is too long, the merge then falls back to
 * defaults, and the next save pushed those defaults through the secure adapter
 * and over the stored key. These run the real store, the real adapter and the
 * real vault over in-memory storage.
 */

const mockPlain = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockOwner = 'a'.repeat(64);

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => mockOwner,
  createProfileScopedStorage: (owner: string) => ({
    getItem: async (key: string) => mockPlain.get(`${key}:profile:${owner}`) ?? null,
    setItem: async (key: string, value: string) => {
      mockPlain.set(`${key}:profile:${owner}`, value);
    },
    removeItem: async (key: string) => {
      mockPlain.delete(`${key}:profile:${owner}`);
    },
  }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    storeLog: noop,
    aiLog: noop,
    nostrLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

const PLAIN_KEY = `routstr-store:profile:${mockOwner}`;
const FUNDED_KEY = 'sk-funded-fixture';

/** A session as 0.0.63 wrote it: `session-<ms>` id, no branch fields. */
function releasedSession(index: number, messages = 1) {
  return {
    id: `session-${1_700_000_000_000 + index}`,
    title: `Chat ${index}`,
    createdAt: 1_700_000_000_000 + index,
    messages: Array.from({ length: messages }, (_, turn) => ({
      id: `${index}-${turn}`,
      role: turn % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${turn}`,
      timestamp: 1_700_000_000_000 + turn,
    })),
  };
}

/**
 * The blob 0.0.63 wrote: zustand's default version 0, the key in plain text,
 * and `conversationHistory` saved beside the sessions. Sessions were
 * prepended, so the newest is first.
 */
function preloadReleased063(sessions: unknown[], extra: Record<string, unknown> = {}) {
  mockPlain.set(
    PLAIN_KEY,
    JSON.stringify({
      state: {
        apiKey: FUNDED_KEY,
        balance: 21_000,
        conversationHistory: [],
        selectedModel: 'gpt-4o',
        sessions,
        currentSessionId: (sessions[0] as { id: string }).id,
        ...extra,
      },
      version: 0,
    })
  );
}

/** Saves are not awaited by zustand. Every double here settles on microtasks. */
const saved = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadStore() {
  const mod =
    require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
  await mod.useRoutstrStore.persist.rehydrate();
  await saved();
  return mod.useRoutstrStore;
}

/** What a later launch would read back: the plain blob joined with the vault. */
async function storedState(): Promise<Record<string, unknown>> {
  const { createRoutstrPersistence } =
    require('@/shared/lib/routstr/securePersistence') as typeof import('@/shared/lib/routstr/securePersistence');
  const raw = await createRoutstrPersistence().getItem('routstr-store');
  return (JSON.parse(raw as string) as { state: Record<string, unknown> }).state;
}

describe('routstr store upgrade past the ceilings', () => {
  beforeEach(() => {
    jest.resetModules();
    mockPlain.clear();
    mockSecure.clear();
  });

  it('keeps the funded key and the newest 1,024 of 1,025 sessions', async () => {
    const sessions = Array.from({ length: 1025 }, (_, i) => releasedSession(1025 - i));
    preloadReleased063(sessions);

    const store = await loadStore();

    expect(store.getState().apiKey).toBe(FUNDED_KEY);
    expect(store.getState().sessions).toHaveLength(1024);
    expect(store.getState().sessions[0].id).toBe(sessions[0].id);
    expect(store.getState().sessions.some((s) => s.id === sessions[1024].id)).toBe(false);

    // One ordinary save after the load.
    store.getState().setBalance(20_000);
    await saved();

    const stored = await storedState();
    expect(stored.apiKey).toBe(FUNDED_KEY);
    expect(stored.sessions).toHaveLength(1024);
    expect(mockPlain.get(PLAIN_KEY)).not.toContain(FUNDED_KEY);
  });

  it('keeps the session that was open even when it is the oldest', async () => {
    const sessions = Array.from({ length: 1025 }, (_, i) => releasedSession(1025 - i));
    preloadReleased063(sessions, { currentSessionId: sessions[1024].id });

    const store = await loadStore();

    expect(store.getState().sessions).toHaveLength(1024);
    expect(store.getState().currentSessionId).toBe(sessions[1024].id);
    expect(store.getState().sessions.some((s) => s.id === sessions[1024].id)).toBe(true);
  });

  it('keeps the newest 10,000 turns of a longer session', async () => {
    preloadReleased063([releasedSession(1, 10_001), releasedSession(0)]);

    const store = await loadStore();

    expect(store.getState().apiKey).toBe(FUNDED_KEY);
    const [long, short] = store.getState().sessions;
    expect(long.messages).toHaveLength(10_000);
    expect(long.messages[0].id).toBe('1-1');
    expect(long.messages[9_999].id).toBe('1-10000');
    expect(short.messages).toHaveLength(1);
  });

  it('drops a session it cannot read without losing the rest', async () => {
    preloadReleased063([releasedSession(2), null, { id: 'no-messages' }, releasedSession(1)]);

    const store = await loadStore();

    expect(store.getState().apiKey).toBe(FUNDED_KEY);
    expect(store.getState().sessions.map((s) => s.title)).toEqual(['Chat 2', 'Chat 1']);
  });

  it('never saves defaults over the key when the schema turns the blob down', async () => {
    // No release wrote a balance like this. The point is that whatever makes
    // the schema say no, the answer must not cost the stored key.
    const sessions = [releasedSession(1)];
    preloadReleased063(sessions, { balance: 'unreadable' });

    const store = await loadStore();
    expect(store.getState().apiKey).toBeNull();
    expect(store.getState().sessions).toEqual([]);

    store.getState().setBalance(1);
    store.getState().createSession();
    await saved();

    const stored = await storedState();
    expect(stored.apiKey).toBe(FUNDED_KEY);
    expect(stored.sessions).toEqual(sessions);
  });

  it('saves again once a later load is accepted', async () => {
    preloadReleased063([releasedSession(1)], { balance: 'unreadable' });
    const store = await loadStore();

    const repaired = JSON.parse(mockPlain.get(PLAIN_KEY) as string);
    repaired.state.balance = 21_000;
    mockPlain.set(PLAIN_KEY, JSON.stringify(repaired));
    await store.persist.rehydrate();
    await saved();
    expect(store.getState().apiKey).toBe(FUNDED_KEY);

    store.getState().setBalance(5);
    await saved();
    expect((await storedState()).balance).toBe(5);
  });

  it('reads a 0.1.3 blob back unchanged', async () => {
    // Version 1, with the branch fields and node override 0.1.3 added.
    const sessions = [
      {
        id: 'session-b',
        title: 'Second',
        createdAt: 2,
        messages: [
          { id: 'm1', role: 'user', content: 'hello', timestamp: 1, parentId: null },
          { id: 'm2', role: 'assistant', content: 'hi', timestamp: 2, parentId: 'm1', costSats: 3 },
        ],
        activeChildren: { m1: 'm2' },
      },
      { id: 'session-a', title: 'First', createdAt: 1, messages: [], activeChildren: {} },
    ];
    mockPlain.set(
      PLAIN_KEY,
      JSON.stringify({
        state: {
          apiKey: FUNDED_KEY,
          balance: 21_000,
          selectedModel: 'openai/gpt-4o',
          sessions,
          currentSessionId: 'session-b',
          lastKnownLineup: null,
          nodeBaseUrl: 'https://node.example',
        },
        version: 1,
      })
    );

    const store = await loadStore();

    expect(store.getState()).toMatchObject({
      apiKey: FUNDED_KEY,
      balance: 21_000,
      selectedModel: 'openai/gpt-4o',
      sessions,
      currentSessionId: 'session-b',
      nodeBaseUrl: 'https://node.example',
    });
    expect(store.getState().sessions).toEqual(sessions);
    const stored = await storedState();
    expect(stored.apiKey).toBe(FUNDED_KEY);
    expect(stored.sessions).toEqual(sessions);
  });
});
