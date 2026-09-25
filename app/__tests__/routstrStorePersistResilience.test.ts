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

jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
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

  it('retains every unsettled payment instead of evicting the oldest recovery token', async () => {
    const store = await loadStore();
    for (let index = 0; index < 33; index++) {
      store.getState().beginPayment(`payment-${index}`, {
        encoded: `cashuB-fixture-${index}`,
        nodeBaseUrl: 'https://node.example',
        operationId: `operation-${index}`,
        startedAt: index,
      });
    }
    const saved = JSON.parse(mockMemory[STORAGE_KEY]);
    expect(Object.keys(saved.state.pendingPayments)).toHaveLength(33);
    expect(saved.state.pendingPayments['payment-0'].encoded).toBe('cashuB-fixture-0');
  });

  it('does not relabel another node catalog as the chosen provider', async () => {
    const store = await loadStore();
    store.getState().setUserNode('https://chosen.example');
    const lineup = emptyLineup();
    lineup.openai.auto = {
      modelId: 'other-node-model',
      displayName: 'Other model',
      contextLength: 8192,
      created: 1,
      visionInput: false,
      satsPricing: {
        prompt: 0,
        completion: 0,
        request: 1,
        image: null,
        max_cost: 1,
      },
      maxCompletionTokens: null,
    };
    store.getState().setServerLineup({ lineup, nodeBaseUrl: 'https://other.example' });
    expect(store.getState().lineup).toBeNull();
    expect(store.getState().lastKnownLineup).toBeNull();
    expect(store.getState().nodeBaseUrl).toBe('https://chosen.example');
  });

  it('does not retain another provider catalog after an explicit switch', async () => {
    const lineup = emptyLineup();
    preload({
      nodeBaseUrl: 'https://old.example',
      userNodeBaseUrl: 'https://old.example',
      lastKnownLineup: { lineup, derivedAt: 1, nodeBaseUrl: 'https://old.example' },
    });
    const store = await loadStore();
    store.getState().setUserNode('https://new.example');
    expect(store.getState().lastKnownLineup).toBeNull();
    expect(store.getState().modelsCache).toBeNull();
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

  it('drops a mismatched catalog on hydrate while retaining its old-node credential', async () => {
    preload({
      apiKey: 'sk-old-node',
      nodeBaseUrl: 'https://old.example',
      userNodeBaseUrl: 'https://chosen.example',
      lastKnownLineup: { lineup: emptyLineup(), derivedAt: 1, nodeBaseUrl: 'https://old.example' },
    });
    const store = await loadStore();
    expect(store.getState().lastKnownLineup).toBeNull();
    expect(store.getState().userNodeBaseUrl).toBe('https://chosen.example');
    expect(store.getState().nodeBaseUrl).toBe('https://old.example');
    expect(store.getState().legacyAccounts['https://old.example'].apiKey).toBe('sk-old-node');
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

  it('reads a lineup written under the old four-key shape', async () => {
    // The lineup used to be `{openai, claude, grok, google}` and is now keyed
    // by vendor, so the catalog can supply the menu. That widening must be
    // read-compatible byte for byte: `createMergeWithSchema` parses this blob
    // once and discards ALL of it on failure — and it holds the apiKey and
    // every chat session.
    const legacyEntry = {
      modelId: 'gpt-5-mini',
      displayName: 'GPT-5 Mini',
      contextLength: 128_000,
      created: 1_750_000_000,
      visionInput: false,
      satsPricing: { prompt: 1e-6, completion: 4e-6, request: 0, image: null, max_cost: 0.5 },
    };
    preload({
      apiKey: 'sk-key',
      sessions: [baseSession],
      lastKnownLineup: {
        derivedAt: 123,
        nodeBaseUrl: 'https://working.example',
        lineup: {
          openai: { auto: legacyEntry, pro: null, max: null },
          claude: { auto: null, pro: null, max: null },
          grok: { auto: null, pro: null, max: null },
          google: { auto: null, pro: null, max: null },
        },
      },
    });

    const store = await loadStore();

    expect(store.getState().apiKey).toBe('sk-key');
    expect(store.getState().sessions).toEqual([baseSession]);
    expect(store.getState().lastKnownLineup?.lineup.openai.auto).toMatchObject({
      modelId: 'gpt-5-mini',
    });
  });

  it('keeps a vendor the app has no id for', async () => {
    preload({
      apiKey: 'sk-key',
      lastKnownLineup: {
        derivedAt: 123,
        nodeBaseUrl: null,
        lineup: {
          qwen: {
            auto: {
              modelId: 'qwen3.5-plus',
              displayName: 'Qwen3.5 Plus',
              contextLength: 128_000,
              created: 1_750_000_000,
              visionInput: false,
              satsPricing: { prompt: 1e-6, completion: 4e-6, request: 0, image: null, max_cost: 1 },
            },
            pro: null,
            max: null,
          },
        },
      },
    });

    const store = await loadStore();
    expect(store.getState().lastKnownLineup?.lineup.qwen?.auto?.modelId).toBe('qwen3.5-plus');
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

/**
 * The spend prompt is not something a past tap can switch off for good.
 *
 * `confirmSpend: false` could only ever be written by the "Always allow"
 * button, whose own copy promised a settings toggle that was never built.
 * Removing the button on its own would have left precisely the users who had
 * pressed it spending without a prompt forever, so the v2 migration hands the
 * prompt back.
 */
describe('the confirmSpend v2 migration', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  const preloadAt = (version: number, state: Record<string, unknown>) => {
    mockMemory[STORAGE_KEY] = JSON.stringify({ state, version });
  };

  it('re-arms the prompt for a blob that had turned it off', async () => {
    preloadAt(1, { apiKey: 'sk-key', balance: 5, confirmSpend: false });

    const store = await loadStore();

    expect(store.getState().confirmSpend).toBe(true);
    // And the migration is a repair, not a reset: everything else in the blob
    // comes through untouched.
    expect(store.getState().apiKey).toBe('sk-key');
    expect(store.getState().balance).toBe(5);
  });

  it('leaves a blob that never turned it off alone', async () => {
    preloadAt(1, { apiKey: 'sk-key', balance: 5, confirmSpend: true });

    const store = await loadStore();

    expect(store.getState().confirmSpend).toBe(true);
    expect(store.getState().apiKey).toBe('sk-key');
  });

  it('rehydrates a v2 blob without a migration pass', async () => {
    preloadAt(2, { apiKey: 'sk-key', balance: 5, confirmSpend: true });

    const store = await loadStore();

    expect(store.getState().confirmSpend).toBe(true);
    expect(store.getState().apiKey).toBe('sk-key');
  });
});

/**
 * v3: the single mutable provider record becomes per-source claims.
 *
 * The blob it migrates is contaminated by the model it replaces. Two
 * discovery readers substituted a provider's hostname for a missing name, and
 * `rememberProviders` treated any non-empty name as authoritative — so a peer
 * node's guess overwrote the provider's own, and on one device 14 of 15
 * visible rows turned into URLs in a single write. A stored name is therefore
 * only carried forward when it is NOT the hostname: once stored, a guess is
 * indistinguishable from a real name, and the whole point of the new model is
 * that it would go on outranking the real one.
 */
describe('the provider-claims v3 migration', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  const preloadAt = (version: number, state: Record<string, unknown>) => {
    mockMemory[STORAGE_KEY] = JSON.stringify({ state, version });
  };

  const NAMED = 'https://ai.example.com';
  const HOSTNAMED = 'https://llm402.ai';

  const legacyBlob = {
    apiKey: 'sk-key',
    knownProviders: {
      [NAMED]: {
        name: 'Example Node',
        description: 'a node',
        version: '0.1.3',
        mints: ['https://mint.example'],
        e2ee: true,
        pubkey: 'a'.repeat(64),
        seenAt: 1700000000000,
      },
      [HOSTNAMED]: {
        name: 'llm402.ai',
        description: null,
        version: null,
        mints: [],
        e2ee: null,
        pubkey: null,
        seenAt: 1700000000001,
      },
    },
  };

  it('folds the old record into one legacy claim and still shows it', async () => {
    preloadAt(2, legacyBlob);

    const store = await loadStore();

    expect(store.getState().knownProviders[NAMED]).toEqual({
      baseUrl: NAMED,
      name: 'Example Node',
      description: 'a node',
      version: '0.1.3',
      pubkey: 'a'.repeat(64),
      mints: ['https://mint.example'],
      e2ee: true,
    });
    expect(store.getState().apiKey).toBe('sk-key');
  });

  it('drops a stored name that is only the provider’s hostname', async () => {
    preloadAt(2, legacyBlob);

    const store = await loadStore();

    // `null`, not `'llm402.ai'`. The row still renders the hostname — that is
    // the row's job — but nothing outranks the real name when it arrives.
    expect(store.getState().knownProviders[HOSTNAMED]?.name).toBeNull();
  });

  it('moves seenAt out of the record, into housekeeping', async () => {
    preloadAt(2, legacyBlob);

    const store = await loadStore();

    expect(store.getState().providerSeenAt[NAMED]).toBe(1700000000000);
    expect(store.getState().knownProviders[NAMED]).not.toHaveProperty('seenAt');
  });

  it('lets any real source replace what the legacy claim held', async () => {
    preloadAt(2, legacyBlob);

    const store = await loadStore();
    store.getState().observeProviders('self', { [HOSTNAMED]: { name: 'Project Ellen' } });

    expect(store.getState().knownProviders[HOSTNAMED]?.name).toBe('Project Ellen');
  });

  it('does not re-render the rows when an observation teaches nothing', async () => {
    preloadAt(2, legacyBlob);

    const store = await loadStore();
    const before = store.getState().knownProviders;
    // A peer repeating what the provider already told us. This is the write
    // that used to publish a fresh map on every probe result.
    store.getState().observeProviders('peer', { [NAMED]: { name: 'Example Node' } });

    expect(store.getState().knownProviders).toBe(before);
    expect(store.getState().providerSeenAt[NAMED]).not.toBe(1700000000000);
  });
});
