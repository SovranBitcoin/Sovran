/**
 * @jest-environment node
 *
 * Routstr's curated model list (Nostr kind 38423, `routstr-21-models`) as the
 * allowlist the lineup is derived against.
 *
 * On 2026-09-26 `privateprovider.xyz` listed `tinfoil-deepseek-v4-flash`, the
 * enclave behind it answered 404 for every request, and the maintainers said
 * the model is deprecated and that they "manage lists using Nostr". The list
 * they publish names `tinfoil-deepseek-v4-1-flash` and not the retired one.
 */

import type { RoutstrModel } from '@/shared/lib/routstr/api';
import {
  curatedIdSet,
  deriveLineup,
  normalizeModelId,
  E2EE_PROVIDER_ID,
} from '@/shared/lib/routstr/lineup';
import { parseCuratedModels } from '@/shared/lib/routstr/curatedModels';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () =>
    jest.requireMock('@/shared/lib/cashu/profileScopedStorage').createProfileScopedStorage(),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    storeLog: noop,
    aiLog: noop,
    apiLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (error: unknown) => error,
  };
});

/** The event content as published on 2026-09-23. */
const PUBLISHED = JSON.stringify({
  models: [
    'gpt-6-sol',
    'glm-5.3',
    'deepseek-v4.1-flash',
    'tinfoil-deepseek-v4-1-flash',
    'tinfoil-glm-5-3',
    'claude-sonnet-5',
  ],
  'blacklisted-nodes': [],
  'whitelisted-nodes': [],
});

const created = () => Math.floor(Date.now() / 1000) - 10_000;
const row = (id: string, completion: number, slug: string | null): RoutstrModel =>
  ({
    id,
    name: id,
    canonical_slug: slug,
    enabled: true,
    created: created(),
    context_length: 256_000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    sats_pricing: {
      prompt: completion / 4,
      completion,
      request: 0.001,
      max_cost: completion * 4000,
    },
    top_provider: { context_length: 256_000, max_completion_tokens: null, is_moderated: false },
    upstream_provider_id: 'tinfoil',
  }) as unknown as RoutstrModel;

/** privateprovider.xyz's sealed catalog: the retired model is the cheapest. */
const SEALED = [
  row('tinfoil-deepseek-v4-flash', 0.0009, null),
  row('tinfoil-deepseek-v4-1-flash', 0.0018, null),
  row('tinfoil-glm-5-3', 0.004, null),
];
/** A vendor the list does not mention at all. */
const QWEN = [
  row('qwen3-next-80b', 0.0005, 'qwen/qwen3-next-80b'),
  row('qwen3-max', 0.003, 'qwen/qwen3-max'),
  row('qwen3-coder', 0.001, 'qwen/qwen3-coder'),
];

describe('one spelling for a model id', () => {
  it('lets the list and a catalog disagree about dots, case and vendor prefixes', () => {
    expect(normalizeModelId('deepseek-v4.1-flash')).toBe('deepseek-v4-1-flash');
    expect(normalizeModelId('deepseek/deepseek-v4-1-flash')).toBe('deepseek-v4-1-flash');
    expect(normalizeModelId('Claude-Sonnet-5')).toBe('claude-sonnet-5');
    // A suffix names a different offering and is kept.
    expect(normalizeModelId('gemini-2.5-flash-lite:batch')).toBe('gemini-2-5-flash-lite:batch');
  });
});

describe('the published list', () => {
  it('parses into ids and node lists', () => {
    expect(parseCuratedModels(PUBLISHED, 1_790_149_204)).toEqual({
      ids: expect.arrayContaining(['tinfoil-deepseek-v4-1-flash', 'deepseek-v4.1-flash']),
      blacklistedNodes: [],
      whitelistedNodes: [],
      updatedAt: 1_790_149_204_000,
    });
  });

  it('is nothing when the content is not the list', () => {
    expect(parseCuratedModels('not json', 1)).toBeNull();
    expect(parseCuratedModels('{"foo":1}', 1)).toBeNull();
  });
});

describe('deriving the lineup against the list', () => {
  const curated = curatedIdSet(JSON.parse(PUBLISHED).models);

  it('keeps a deprecated model out of the ladder when the vendor has listed ones', () => {
    const { lineup, stats } = deriveLineup(SEALED, undefined, curated);
    const ids = ['auto', 'pro', 'max'].map(
      (tier) => lineup[E2EE_PROVIDER_ID]?.[tier as 'auto' | 'pro' | 'max']?.modelId ?? null
    );
    expect(ids).not.toContain('tinfoil-deepseek-v4-flash');
    // The cheapest LISTED model is now Auto.
    expect(lineup[E2EE_PROVIDER_ID]?.auto?.modelId).toBe('tinfoil-deepseek-v4-1-flash');
    expect(stats.perProvider[E2EE_PROVIDER_ID]).toMatchObject({ qualifying: 3, curated: 2 });
  });

  it('keeps a vendor the list never mentions exactly as it was', () => {
    const withList = deriveLineup(QWEN, undefined, curated);
    const without = deriveLineup(QWEN, undefined, null);
    expect(withList.lineup.qwen).toEqual(without.lineup.qwen);
    expect(withList.stats.perProvider.qwen).toMatchObject({ qualifying: 3, curated: 0 });
  });

  it('changes nothing when there is no list', () => {
    const { lineup } = deriveLineup(SEALED, undefined, null);
    expect(lineup[E2EE_PROVIDER_ID]?.auto?.modelId).toBe('tinfoil-deepseek-v4-flash');
  });
});

describe('the store', () => {
  beforeEach(async () => {
    await useRoutstrStore.persist.rehydrate();
    useRoutstrStore.setState({
      lineup: null,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      curatedModels: null,
      nodeBaseUrl: 'https://privateprovider.xyz',
      selectedProvider: E2EE_PROVIDER_ID,
      selectedTier: 'auto',
    });
  });

  it('re-derives the lineup when the list arrives after the catalog', () => {
    useRoutstrStore.getState().setCachedModels(SEALED);
    expect(useRoutstrStore.getState().lineup?.[E2EE_PROVIDER_ID]?.auto?.modelId).toBe(
      'tinfoil-deepseek-v4-flash'
    );
    useRoutstrStore.getState().setCuratedModels({
      ids: JSON.parse(PUBLISHED).models,
      blacklistedNodes: [],
      whitelistedNodes: [],
      updatedAt: 1,
      fetchedAt: Date.now(),
    });
    expect(useRoutstrStore.getState().lineup?.[E2EE_PROVIDER_ID]?.auto?.modelId).toBe(
      'tinfoil-deepseek-v4-1-flash'
    );
  });

  it('derives against a list it already holds', () => {
    useRoutstrStore.setState({
      curatedModels: {
        ids: JSON.parse(PUBLISHED).models,
        blacklistedNodes: [],
        whitelistedNodes: [],
        updatedAt: 1,
        fetchedAt: Date.now(),
      },
    });
    useRoutstrStore.getState().setCachedModels(SEALED);
    expect(useRoutstrStore.getState().lineup?.[E2EE_PROVIDER_ID]?.auto?.modelId).toBe(
      'tinfoil-deepseek-v4-1-flash'
    );
  });
});
