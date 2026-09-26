/**
 * A selection is a PAIR, and both halves have to name something real.
 *
 * `routstrLineupSelection` pins the vendor half: when the lineup moves
 * underneath a sticky `selectedProvider`, the store re-points it onto a vendor
 * the new node actually serves. It stops there — `selectedTier` is carried
 * across untouched — and a tier is not a global constant either. `pickTiers`
 * fills partial ladders deterministically (2 qualifying models → Auto + Max,
 * 1 → Auto only), so a vendor the repoint lands on routinely has no Pro rung
 * at all.
 *
 * From `app/log.txt`, session `mugrq1a3-60ce16`:
 *
 *   09:39:28  store.routstr.user_node_set    {"pinned": true}
 *   09:39:29  store.routstr.provider_repointed {"from":"openai","to":"tinfoil",
 *                                               "offered":["tinfoil"]}
 *   09:39:29  ai.tier.affordability_snapshot  cells all providerId=tinfoil
 *
 * That node's catalogue is ten rows and qualifies two, so its only vendor has
 * exactly Auto and Max. A user sitting on Pro when they pinned it keeps Pro,
 * and the pair (tinfoil, pro) then names an empty cell: the chip prints "Pro"
 * beside a model from a different rung, the picker marks no row current, and
 * the tier the user believes they are on is not the tier being sent. That is
 * the second half of "changed provider, model did not follow".
 *
 * The same standard applies to the tier the USER picks. `setSelectedSlot`
 * validates the vendor against `lineupProviderIds(lineup)` — the vendors this
 * node offers — and validated the tier against `AI_TIER_IDS`, which is the
 * global list of tier NAMES and cannot say whether this vendor fills that
 * rung. Both halves are now held to the lineup.
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

/**
 * The pinned node from the log above: two sealed rows and nothing else. Two
 * qualifying models is the documented partial fill — Auto and Max, no Pro.
 */
const SEALED_PAIR: RoutstrModel[] = [
  row('tinfoil-deepseek-v4-flash', 0.0011, null),
  row('tinfoil-glm-5-3', 0.004, null),
];

/** A plaintext vendor with a full three-rung ladder, so the boot default has
 *  somewhere real to sit. */
const NAMED: RoutstrModel[] = [
  row('gpt-oss-20b', 0.0004, 'openai/gpt-oss-20b'),
  row('gpt-5.4', 0.01, 'openai/gpt-5.4'),
  row('gpt-5.4-mini', 0.002, 'openai/gpt-5.4-mini'),
];

/**
 * A node serving one model from one named vendor. Auto only — and a named
 * vendor, because the ladder minimum drops an unnamed one this thin before it
 * can reach the menu at all.
 */
const ONE_RUNG: RoutstrModel[] = [row('gemini-3-flash', 0.003, 'google/gemini-3-flash')];

/** Every tier this vendor actually fills, in ladder order. */
const filledTiers = (provider: string): string[] => {
  const lineup = useRoutstrStore.getState().lineup;
  return (['auto', 'pro', 'max'] as const).filter((t) => lineup?.[provider]?.[t] != null);
};

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

describe('the repoint moves the whole pair', () => {
  it('lands on a tier the new vendor fills, not the one carried across', () => {
    useRoutstrStore.setState({ selectedProvider: 'openai', selectedTier: 'pro' });
    useRoutstrStore.getState().setCachedModels(SEALED_PAIR);

    const state = useRoutstrStore.getState();
    // The vendor half already worked; this is the half that did not follow.
    expect(state.selectedProvider).toBe(E2EE_PROVIDER_ID);
    expect(filledTiers(E2EE_PROVIDER_ID)).toEqual(['auto', 'max']);
    expect(state.lineup?.[E2EE_PROVIDER_ID]?.pro).toBeNull();
    // Carrying `pro` across names an empty cell on the vendor we just moved to.
    expect(state.lineup?.[state.selectedProvider]?.[state.selectedTier]).not.toBeNull();
    expect(state.selectedTier).toBe('auto');
  });

  it('repairs the tier even when the vendor itself still resolves', () => {
    // The lineup can thin out under a selection without moving it: the same
    // node, a later catalogue read, one qualifying model left for this vendor.
    useRoutstrStore.getState().setCachedModels(NAMED);
    useRoutstrStore.setState({ selectedProvider: 'openai', selectedTier: 'max' });
    useRoutstrStore.getState().setCachedModels([row('gpt-5.4', 0.01, 'openai/gpt-5.4')]);

    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe('openai');
    expect(filledTiers('openai')).toEqual(['auto']);
    expect(state.selectedTier).toBe('auto');
  });

  it('leaves a pair the lineup still answers exactly where it was', () => {
    useRoutstrStore.setState({ selectedProvider: 'openai', selectedTier: 'max' });
    useRoutstrStore.getState().setCachedModels(NAMED);
    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe('openai');
    expect(state.selectedTier).toBe('max');
  });

  it('spends nothing on a catalogue that qualifies nothing', () => {
    // An empty derivation is a placeholder, not a verdict — the same rule the
    // vendor half already obeys.
    useRoutstrStore.setState({ selectedProvider: 'openai', selectedTier: 'max' });
    useRoutstrStore.getState().setCachedModels([]);
    expect(useRoutstrStore.getState().selectedTier).toBe('max');
  });

  it('applies to the snapshot a cold start boots on', async () => {
    useRoutstrStore.getState().setCachedModels(ONE_RUNG);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A cold start: the derived lineup and the catalogue are gone (both are
    // session-only) and the pair is back at its boot defaults — except the
    // tier, which a user could equally have moved before the relaunch.
    useRoutstrStore.setState({
      lineup: null,
      modelsCache: null,
      selectedProvider: 'openai',
      selectedTier: 'max',
    });
    await useRoutstrStore.persist.rehydrate();

    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe('google');
    expect(state.selectedTier).toBe('auto');
    expect(state.lastKnownLineup?.lineup?.google?.auto).not.toBeNull();
  });
});

describe('the tier a user picks is validated against the vendor, not the names', () => {
  it('clamps a tier the chosen vendor does not fill', () => {
    useRoutstrStore.getState().setCachedModels([...NAMED, ...SEALED_PAIR]);
    // `pro` is a real tier id and an empty cell on this vendor. The vendor half
    // of this call is checked against the lineup; the tier half must be too.
    useRoutstrStore.getState().setSelectedSlot({ provider: E2EE_PROVIDER_ID, tier: 'pro' });

    const state = useRoutstrStore.getState();
    expect(state.selectedProvider).toBe(E2EE_PROVIDER_ID);
    expect(state.selectedTier).toBe('auto');
  });

  it('keeps a tier the chosen vendor does fill', () => {
    useRoutstrStore.getState().setCachedModels([...NAMED, ...SEALED_PAIR]);
    useRoutstrStore.getState().setSelectedSlot({ provider: E2EE_PROVIDER_ID, tier: 'max' });
    expect(useRoutstrStore.getState().selectedTier).toBe('max');
  });

  it('takes the user at their word when no lineup can answer yet', () => {
    // Before a catalogue lands there is nothing real to check against, and a
    // silent clamp to Auto would overwrite a deliberate choice.
    useRoutstrStore.getState().setSelectedSlot({ provider: 'openai', tier: 'max' });
    expect(useRoutstrStore.getState().selectedTier).toBe('max');
  });

  it('still rejects a tier that is not a tier', () => {
    useRoutstrStore.getState().setCachedModels(NAMED);
    useRoutstrStore
      .getState()
      .setSelectedSlot({ provider: 'openai', tier: 'turbo' as unknown as 'auto' });
    expect(useRoutstrStore.getState().selectedTier).toBe('auto');
  });
});
