/**
 * Choosing a Routstr provider, and not being moved off it.
 *
 * nagg picks a node on catalog health alone and the app follows. That is the
 * right default and the wrong rule: it is how a user ended up on a node whose
 * every completion 402'd, and how a balance got left behind. Pinning is what
 * makes the choice the user's; these tests pin that a background refresh, and
 * a relaunch, both respect it.
 */

import { emptyLineup } from '@/shared/lib/routstr/lineup';
import { fetchProviderDirectory, normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

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
    apiLog: noop,
    aiLog: noop,
    storeLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

jest.mock('@/shared/lib/http/requestSignal', () => ({
  DEFAULT_TIMEOUT_MS: 10_000,
  buildAbortSignal: () => undefined,
}));

const lineupWith = (modelId: string) => {
  const lineup = emptyLineup();
  lineup.openai.auto = {
    modelId,
    displayName: modelId,
    contextLength: 200_000,
    created: 1,
    visionInput: false,
    satsPricing: { prompt: 0.0001, completion: 0.0004, request: 0.001, image: 0, max_cost: 32 },
  };
  return lineup;
};

describe('pinning a provider', () => {
  beforeEach(() => {
    useRoutstrStore.setState({
      userNodeBaseUrl: null,
      nodeBaseUrl: 'https://nagg-pick.example',
      lineup: null,
      serverLineupAt: null,
      modelsCache: { data: [], timestamp: 1 },
    });
  });

  it('drops the other node’s models when the provider changes', () => {
    // The model menu is per node. Keeping the old catalog would offer models
    // the new node may not serve, priced at the old node's rates.
    useRoutstrStore.getState().setUserNode('https://chosen.example/');

    expect(useRoutstrStore.getState()).toMatchObject({
      userNodeBaseUrl: 'https://chosen.example',
      nodeBaseUrl: 'https://chosen.example',
      lineup: null,
      serverLineupAt: null,
      modelsCache: null,
    });
  });

  it('does not let a nagg refresh move a pinned user off their provider', () => {
    useRoutstrStore.getState().setUserNode('https://chosen.example');

    useRoutstrStore.getState().setServerLineup({
      lineup: lineupWith('some-model'),
      nodeBaseUrl: 'https://nagg-moved-on.example',
      authMode: 'x-cashu',
    });

    expect(useRoutstrStore.getState().nodeBaseUrl).toBe('https://chosen.example');
    // The curated ladder is still worth taking — it is the models, not the node.
    expect(useRoutstrStore.getState().lineup?.openai.auto?.modelId).toBe('some-model');
    // An authMode declared for a node we are not using must not be adopted.
    expect(useRoutstrStore.getState().authMode).toBe('bearer');
  });

  it('follows nagg again once the pin is released', () => {
    useRoutstrStore.getState().setUserNode('https://chosen.example');
    useRoutstrStore.getState().setUserNode(null);

    useRoutstrStore.getState().setServerLineup({
      lineup: lineupWith('some-model'),
      nodeBaseUrl: 'https://nagg-moved-on.example',
    });

    expect(useRoutstrStore.getState().nodeBaseUrl).toBe('https://nagg-moved-on.example');
    expect(useRoutstrStore.getState().userNodeBaseUrl).toBeNull();
  });
});

describe('provider directory', () => {
  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
    global.fetch = realFetch;
  });
  const stub = (body: unknown, status = 200) => {
    // eslint-disable-next-line no-restricted-properties -- test seam
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
  };

  it('normalises two spellings of one node to one row', () => {
    expect(normalizeNodeUrl('https://a.example/v1')).toBe('https://a.example');
    expect(normalizeNodeUrl('https://a.example///')).toBe('https://a.example');
  });

  it('keeps https endpoints and drops what the app cannot reach', async () => {
    stub({
      providers: [
        { endpoint_url: 'https://good.example', name: 'Good' },
        // Tor needs a proxy the app does not have.
        { endpoint_url: 'http://abc.onion', name: 'Onion' },
        // Plain http would put a bearer Cashu token on the wire in the clear.
        { endpoint_url: 'http://insecure.example', name: 'Insecure' },
        { endpoint_urls: ['http://x.onion', 'https://second.example'], name: 'Second' },
        // Same node, different spelling.
        { endpoint_url: 'https://good.example/v1/', name: 'Duplicate' },
      ],
    });

    const providers = await fetchProviderDirectory('https://node.example');

    expect(providers.map((p) => p.baseUrl)).toEqual([
      'https://good.example',
      'https://second.example',
    ]);
  });

  it('treats a node without a directory as a node, not an error', async () => {
    stub({ detail: 'Not found' }, 404);
    await expect(fetchProviderDirectory('https://node.example')).resolves.toEqual([]);
  });

  it('survives a body it cannot parse', async () => {
    stub({ providers: 'not-an-array' });
    await expect(fetchProviderDirectory('https://node.example')).resolves.toEqual([]);
  });
});
