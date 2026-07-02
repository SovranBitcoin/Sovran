/**
 * Persist-tolerance regression for the routstr store's new dynamic-lineup
 * and attachment fields. `createMergeWithSchema` runs ONE parse over the
 * whole blob and discards it entirely on failure — and this blob holds the
 * Routstr apiKey (a bearer credential over a sat balance) plus every chat
 * session. One malformed attachment or lineup snapshot must therefore
 * degrade in place, never take the blob down (the settingsStore
 * balanceSplitVariant wipe is the canonical prior incident).
 */

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  }),
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    storeLog: noop,
    aiLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

const STORAGE_KEY = 'routstr-store';

function preload(state: Record<string, unknown>) {
  mockMemory[STORAGE_KEY] = JSON.stringify({ state, version: 1 });
}

async function loadStore() {
  const mod =
    require('@/shared/stores/profile/routstrStore') as typeof import('@/shared/stores/profile/routstrStore');
  await mod.useRoutstrStore.persist.rehydrate();
  return mod.useRoutstrStore;
}

const baseSession = {
  id: 'session-1',
  title: 'Chat',
  createdAt: 1,
  messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
};

describe('routstrStore persist resilience', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  it('parses a legacy blob that predates lastKnownLineup and attachments', async () => {
    preload({
      apiKey: 'sk-legacy-key',
      balance: 1234,
      selectedModel: null,
      sessions: [baseSession],
      currentSessionId: 'session-1',
    });

    const store = await loadStore();

    expect(store.getState().apiKey).toBe('sk-legacy-key');
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().lastKnownLineup).toBeNull();
    // Working copy restored from the active session row.
    expect(store.getState().conversationHistory).toHaveLength(1);
  });

  it('keeps apiKey + sessions when a message carries malformed attachments', async () => {
    preload({
      apiKey: 'sk-key',
      balance: 5,
      selectedModel: null,
      sessions: [
        {
          ...baseSession,
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: 'photo turn',
              timestamp: 1,
              // width as string + missing mimeType/localUri types — the
              // array degrades to [] instead of failing the blob parse.
              attachments: [{ localUri: 42, mimeType: null, width: 'wide' }],
            },
          ],
        },
      ],
      currentSessionId: 'session-1',
    });

    const store = await loadStore();

    expect(store.getState().apiKey).toBe('sk-key');
    expect(store.getState().sessions).toHaveLength(1);
    const message = store.getState().sessions[0].messages[0];
    expect(message.content).toBe('photo turn');
    expect(message.attachments ?? []).toHaveLength(0);
  });

  it('keeps apiKey + sessions when the persisted lineup snapshot is garbage', async () => {
    preload({
      apiKey: 'sk-key',
      balance: 5,
      selectedModel: null,
      sessions: [baseSession],
      currentSessionId: 'session-1',
      lastKnownLineup: { derivedAt: 'yesterday', lineup: 'not-a-lineup' },
    });

    const store = await loadStore();

    expect(store.getState().apiKey).toBe('sk-key');
    expect(store.getState().sessions).toHaveLength(1);
    // Malformed snapshot degrades to null; the menu re-derives on next fetch.
    expect(store.getState().lastKnownLineup).toBeNull();
  });

  it('round-trips valid attachments and lineup snapshots intact', async () => {
    const attachment = {
      localUri: 'file:///photos/a.jpg',
      mimeType: 'image/jpeg',
      width: 100,
      height: 200,
    };
    const entry = {
      modelId: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 5',
      contextLength: 1_000_000,
      created: 1_782_843_083,
      visionInput: true,
      satsPricing: { prompt: 0.002, completion: 0.01, request: 0, image: null, max_cost: 3742 },
    };
    const provider = { auto: null, pro: null, max: entry };
    const empty = { auto: null, pro: null, max: null };
    preload({
      apiKey: 'sk-key',
      balance: 5,
      selectedModel: null,
      sessions: [
        {
          ...baseSession,
          messages: [
            { id: 'm1', role: 'user', content: 'photo', timestamp: 1, attachments: [attachment] },
          ],
        },
      ],
      currentSessionId: 'session-1',
      lastKnownLineup: {
        derivedAt: 123,
        lineup: { openai: empty, claude: provider, grok: empty, google: empty },
      },
    });

    const store = await loadStore();

    expect(store.getState().sessions[0].messages[0].attachments).toEqual([attachment]);
    expect(store.getState().lastKnownLineup?.lineup.claude.max?.modelId).toBe('claude-sonnet-5');
  });
});
