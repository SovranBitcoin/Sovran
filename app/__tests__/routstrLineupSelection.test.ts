/**
 * The selected vendor has to survive the lineup moving underneath it.
 *
 * `selectedProvider` is sticky session state and boots to `openai`; a lineup
 * is whatever the node in front of the app right now serves. Pinning a node
 * replaces the whole vendor set, and nothing re-examined the selection
 * afterwards — `setSelectedSlot` validates the vendor the USER picks and
 * nothing validated the one the lineup left stranded.
 *
 * On device that produced a send button that did nothing. From `app/log.txt`,
 * session `mugkrzsp-5tecjk`:
 *
 *   06:24:34  store.routstr.user_node_set   {"pinned": true}
 *   06:24:35  ai.lineup.derived             {"catalogSize": 10, "totalQualifying": 2,
 *                                            "perProvider": {"tinfoil": {"qualifying": 2}},
 *                                            "allProvidersEmpty": false}
 *   06:24:35  ai.tier.affordability_snapshot lineupSource=live, cells all providerId=tinfoil,
 *                                            selectedProvider=openai
 *   06:24:52  ai.send.no_lineup             {"hasCatalog": true}
 *   06:24:56 … 06:25:02  ai.send.no_lineup  ×4 more, all retries, all hasCatalog:true
 *
 * A refusal to send carrying `hasCatalog: true` is not a contradiction once
 * you see the middle line: the catalogue landed, the lineup derived, and the
 * lineup contained exactly one vendor — which was not the one selected. Six of
 * the eleven `ai.send.no_lineup` events in that log are this.
 *
 * The repair is here rather than in the send path's fallback on purpose. A
 * plaintext candidate chain must not drift into the encrypted vendor (it would
 * spend enclave prices unasked — see `aiE2eeCandidateChain`), so the honest
 * move is to put the user ON that vendor, where the chip shows the padlock and
 * the model it resolved to.
 */

import type { RoutstrModel } from '@/shared/lib/routstr/api';
import { E2EE_PROVIDER_ID } from '@/shared/lib/routstr/lineup';

import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

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
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    storeLog: noop,
    aiLog: noop,
    apiLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

/** Recent enough to sit inside the lineup's freshness window whenever this
 *  file runs, so tier assignment does not rot with the calendar. */
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
    upstream_provider_id: 'upstream',
  }) as unknown as RoutstrModel;

/** The ten-row sealed catalogue the pinned node in the log above served. */
const SEALED_ONLY: RoutstrModel[] = [
  row('tinfoil-deepseek-v4-flash', 0.0011, null),
  row('tinfoil-glm-5-3', 0.004, null),
];

/** An ordinary node that happens to serve no vendor the app ships a logo for. */
const UNNAMED_ONLY: RoutstrModel[] = [
  row('qwen3-next-80b', 0.0005, 'qwen/qwen3-next-80b'),
  row('qwen3-max', 0.003, 'qwen/qwen3-max'),
  row('qwen3-coder', 0.001, 'qwen/qwen3-coder'),
];

const NAMED: RoutstrModel[] = [
  row('gpt-oss-20b', 0.0004, 'openai/gpt-oss-20b'),
  row('gpt-5.4', 0.01, 'openai/gpt-5.4'),
  row('gpt-5.4-mini', 0.002, 'openai/gpt-5.4-mini'),
];

beforeEach(async () => {
  await useRoutstrStore.persist.rehydrate();
  useRoutstrStore.setState({
    lineup: null,
    lastKnownLineup: null,
    modelsCache: null,
    serverLineupAt: null,
    nodeBaseUrl: 'https://node.example',
    selectedProvider: 'openai',
    selectedTier: 'auto',
  });
});

describe('selection follows the lineup', () => {
  it('re-points onto a vendor the node actually serves', () => {
    useRoutstrStore.getState().setCachedModels(UNNAMED_ONLY);
    const state = useRoutstrStore.getState();
    // The lineup derived — this is the state that used to refuse to send.
    expect(Object.keys(state.lineup ?? {}).filter((p) => state.lineup?.[p]?.auto)).toEqual([
      'qwen',
    ]);
    expect(state.selectedProvider).toBe('qwen');
  });

  it('lands on the encrypted vendor only when it is the only one offered', () => {
    useRoutstrStore.getState().setCachedModels(SEALED_ONLY);
    expect(useRoutstrStore.getState().selectedProvider).toBe(E2EE_PROVIDER_ID);
  });

  it('prefers a plaintext vendor over the encrypted one when both are offered', () => {
    useRoutstrStore.setState({ selectedProvider: 'claude' });
    useRoutstrStore.getState().setCachedModels([...SEALED_ONLY, ...UNNAMED_ONLY]);
    // `claude` is not on this node; `qwen` and `tinfoil` are. Enclave rows are
    // the dearest in any catalogue, so they are the last resort, not the first.
    expect(useRoutstrStore.getState().selectedProvider).toBe('qwen');
  });

  it('never moves an encrypted selection onto a plaintext vendor', () => {
    // The one direction that would break a promise the user made explicitly.
    // A node with no sealed model has to say so (`routstr.e2ee_unavailable`),
    // not quietly answer the prompt in the clear.
    useRoutstrStore.setState({ selectedProvider: E2EE_PROVIDER_ID });
    useRoutstrStore.getState().setCachedModels(NAMED);
    expect(useRoutstrStore.getState().selectedProvider).toBe(E2EE_PROVIDER_ID);
  });

  it('leaves a selection the lineup still offers alone', () => {
    useRoutstrStore.getState().setCachedModels([...NAMED, ...UNNAMED_ONLY]);
    expect(useRoutstrStore.getState().selectedProvider).toBe('openai');
  });

  it('applies the same rule to the snapshot a cold start boots on', async () => {
    // `selectedProvider` is session-only and boots to `openai`, while
    // `lastKnownLineup` is persisted and belongs to whichever node was last
    // used. Until this session's catalogue lands that snapshot IS the lineup
    // every reader falls through to, so the pairing has to hold there too.
    useRoutstrStore.getState().setCachedModels(UNNAMED_ONLY);
    expect(useRoutstrStore.getState().lastKnownLineup).not.toBeNull();
    // Let the persist middleware write the snapshot it just derived.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A cold start: the derived lineup and the catalogue are gone (both are
    // session-only) and the selection is back at its boot default.
    useRoutstrStore.setState({
      lineup: null,
      modelsCache: null,
      selectedProvider: 'openai',
    });
    await useRoutstrStore.persist.rehydrate();
    expect(useRoutstrStore.getState().lastKnownLineup).not.toBeNull();
    expect(useRoutstrStore.getState().selectedProvider).toBe('qwen');
  });

  it('leaves the selection alone when a catalogue qualifies nothing', () => {
    // An empty derivation is a placeholder, not a verdict — the store already
    // refuses to let one replace a working lineup, and it must not spend the
    // user's selection on one either.
    useRoutstrStore.getState().setCachedModels([]);
    expect(useRoutstrStore.getState().selectedProvider).toBe('openai');
  });
});

describe('a selection carried across a switch the user made', () => {
  // The rule above holds when the lineup moves UNDER the user. When the user
  // moves themselves — "Use this provider" on a page that has just told them,
  // at the top, whether the node can read their messages — a selection carried
  // from the old node is re-fitted like any other, sealed or not. Leaving it
  // pinned to a vendor the new node does not serve is the "changing provider
  // sometimes fails, a restart fixes it" report: the chip read "Not on this
  // node" until a relaunch reset the session-only selection.

  beforeEach(() => {
    // Sealed selection made against the old node, which served it.
    useRoutstrStore.setState({ nodeBaseUrl: 'https://sealed.example' });
    useRoutstrStore.getState().setCachedModels(SEALED_ONLY);
    expect(useRoutstrStore.getState().selectedProvider).toBe(E2EE_PROVIDER_ID);
  });

  it('moves a sealed selection onto the best plaintext fit when the new node serves nothing sealed', () => {
    useRoutstrStore.getState().setUserNode('https://plain.example');
    expect(useRoutstrStore.getState().selectionCarriedFrom).toBe('https://sealed.example');
    useRoutstrStore.getState().setCachedModels(NAMED);
    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe('openai');
    expect(state.selectedTier).toBe('auto');
    // Spent: the next lineup change is the lineup moving under the user again.
    expect(state.selectionCarriedFrom).toBeNull();
  });

  it('keeps a sealed selection when the new node serves it too', () => {
    useRoutstrStore.setState({ selectedTier: 'max' });
    useRoutstrStore.getState().setUserNode('https://also-sealed.example');
    useRoutstrStore.getState().setCachedModels([...SEALED_ONLY, ...NAMED]);
    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe(E2EE_PROVIDER_ID);
    expect(state.selectedTier).toBe('max');
  });

  it('waits for a lineup with entries before spending the note', () => {
    useRoutstrStore.getState().setUserNode('https://slow.example');
    useRoutstrStore.getState().setCachedModels([]);
    expect(useRoutstrStore.getState().selectedProvider).toBe(E2EE_PROVIDER_ID);
    expect(useRoutstrStore.getState().selectionCarriedFrom).toBe('https://sealed.example');
    useRoutstrStore.getState().setCachedModels(UNNAMED_ONLY);
    expect(useRoutstrStore.getState().selectedProvider).toBe('qwen');
    expect(useRoutstrStore.getState().selectionCarriedFrom).toBeNull();
  });

  it('still refuses the downgrade once the carried selection has been re-fitted', () => {
    useRoutstrStore.getState().setUserNode('https://also-sealed.example');
    useRoutstrStore.getState().setCachedModels([...SEALED_ONLY, ...NAMED]);
    expect(useRoutstrStore.getState().selectedProvider).toBe(E2EE_PROVIDER_ID);
    // The node's catalogue drifts and drops its sealed rows: a change under
    // the user, so the promise holds and the send path says so instead.
    useRoutstrStore.setState({ modelsCache: null });
    useRoutstrStore.getState().setCachedModels(NAMED);
    expect(useRoutstrStore.getState().selectedProvider).toBe(E2EE_PROVIDER_ID);
  });
});
