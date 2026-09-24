/**
 * Persist-tolerance regression for the routstr store's new dynamic-lineup
 * and attachment fields. `createMergeWithSchema` runs ONE parse over the
 * whole blob and discards it entirely on failure — and this blob holds the
 * Routstr apiKey (a bearer credential over a sat balance) plus every chat
 * session. One malformed attachment or lineup snapshot must therefore
 * degrade in place, never take the blob down (the settingsStore
 * balanceSplitVariant wipe is the canonical prior incident).
 */

import { emptyLineup } from '@/shared/lib/routstr/lineup';

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

// No @sovranbitcoin/schemas mock: this store's import graph reaches the
// real package at module scope (routstr/api → apiClient → schema extends,
// and `wallet`'s lnurl parseWith), and the real package loads fine under
// jest — a partial mock breaks whichever module-scope consumer it misses.

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

  it.each([undefined, 'future', null, 42])(
    'keeps credentials and sessions with absent/invalid authMode (%s)',
    async (authMode) => {
      preload({ apiKey: 'sk-key', sessions: [baseSession], authMode });
      const store = await loadStore();
      expect(store.getState()).toMatchObject({
        apiKey: 'sk-key',
        authMode: 'bearer',
        sessions: [baseSession],
      });
    }
  );

  it('rehydrates server freshness and the last working snapshot node', async () => {
    preload({
      apiKey: 'sk-key',
      sessions: [baseSession],
      authMode: 'x-cashu',
      serverLineupAt: 123,
      lastKnownLineup: {
        derivedAt: 123,
        lineup: emptyLineup(),
        nodeBaseUrl: 'https://working.example',
      },
    });
    const store = await loadStore();
    expect(store.getState()).toMatchObject({
      nodeBaseUrl: 'https://working.example',
      serverLineupAt: 123,
      authMode: 'x-cashu',
      apiKey: 'sk-key',
    });
  });

  it('drops invalid snapshot metadata without losing the lineup or credentials', async () => {
    preload({
      apiKey: 'sk-key',
      sessions: [baseSession],
      lastKnownLineup: {
        derivedAt: 123,
        lineup: emptyLineup(),
        nodeBaseUrl: 42,
      },
    });
    const store = await loadStore();
    expect(store.getState()).toMatchObject({
      apiKey: 'sk-key',
      sessions: [baseSession],
      lastKnownLineup: { derivedAt: 123, nodeBaseUrl: null },
    });
  });

  it('persists invalidation without dropping the offline snapshot', async () => {
    const snapshot = {
      derivedAt: 123,
      lineup: emptyLineup(),
      nodeBaseUrl: 'https://working.example',
    };
    preload({ apiKey: 'sk-key', serverLineupAt: 123, lastKnownLineup: snapshot });
    const store = await loadStore();
    store.getState().invalidateServerLineup();
    await store.persist.rehydrate();
    expect(store.getState().serverLineupAt).toBeNull();
    expect(store.getState().lastKnownLineup).toEqual(snapshot);
    expect(store.getState().apiKey).toBe('sk-key');
  });

  it.each([undefined, 'future', -1])(
    'tolerates missing/invalid server timestamps (%s)',
    async (serverLineupAt) => {
      preload({ apiKey: 'sk-key', sessions: [baseSession], serverLineupAt });
      const store = await loadStore();
      expect(store.getState()).toMatchObject({
        apiKey: 'sk-key',
        sessions: [baseSession],
        serverLineupAt: null,
      });
    }
  );

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

describe('archived credentials survive a bad blob', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  it('loses one malformed row, not every provider key', async () => {
    // Under a bare `z.record` a single bad entry rejects the record and, through
    // `createMergeWithSchema`, the whole blob — taking every other provider's
    // key with it. `tolerantRecord` costs one row.
    preload({
      apiKey: 'sk-live',
      legacyAccounts: {
        'https://good.example': { apiKey: 'sk-good', lastKnownBalanceMsats: 250_000 },
        'https://bad.example': { apiKey: 42 },
      },
    });

    const store = await loadStore();

    expect(store.getState().legacyAccounts['https://good.example']?.apiKey).toBe('sk-good');
    expect(store.getState().legacyAccounts['https://bad.example']).toBeUndefined();
    expect(store.getState().apiKey).toBe('sk-live');
  });

  it('seeds the live credential on hydrate so it is recoverable before anything clears it', async () => {
    // A blob written before this field existed has no other way to learn about
    // its own key, and that key may be the only route back to a balance on a
    // node the app has since been repointed away from.
    preload({ apiKey: 'sk-live', balance: 250_000, nodeBaseUrl: 'https://old.example' });

    const store = await loadStore();

    expect(store.getState().legacyAccounts['https://old.example']).toMatchObject({
      apiKey: 'sk-live',
      lastKnownBalanceMsats: 250_000,
      reclaimedAt: null,
    });
  });

  it('does not re-seed a credential already archived', async () => {
    preload({
      apiKey: 'sk-live',
      balance: 0,
      nodeBaseUrl: 'https://old.example',
      legacyAccounts: {
        'https://old.example': {
          apiKey: 'sk-live',
          lastKnownBalanceMsats: 250_000,
          archivedAt: 7,
          reclaimedAt: null,
        },
      },
    });

    const store = await loadStore();

    // The richer record wins: a later zero reading must not erase what the
    // node was last known to hold.
    expect(store.getState().legacyAccounts['https://old.example']).toMatchObject({
      lastKnownBalanceMsats: 250_000,
      archivedAt: 7,
    });
  });
});
