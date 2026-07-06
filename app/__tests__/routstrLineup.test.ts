/**
 * Pins `deriveLineup`'s selection contract against a fixture trimmed from a
 * live `/v1/models` snapshot (2026-07-02, 338 models) plus two synthetic
 * rows: an xAI rolling alias (the live catalog had none that day, but the
 * per-provider dedup rule must stay pinned for all four providers) and a
 * disabled OpenAI row.
 *
 * The old hardcoded TIER_MATRIX rotted silently when the catalog drifted —
 * these tests are the tripwire that replaces it: refresh the fixture from
 * the live endpoint and any convention change (alias '~' marker, name
 * prefixes, pricing shape) fails loudly here instead of rendering
 * "cost unavailable" on device.
 */
import fixture from './fixtures/routstr-models.fixture.json';
import type { RoutstrModel } from '@/shared/lib/routstr/api';
import {
  AI_PROVIDER_IDS,
  AI_TIER_IDS,
  NaggAiLineupSchema,
  deriveLineup,
  emptyLineup,
  lineupFromNaggPayload,
  lineupHasEntries,
  mergeLineupWithLastKnown,
  providerIdForModel,
  type AiLineup,
  type LineupEntry,
} from '@/shared/lib/routstr/lineup';

const MODELS = fixture.data as unknown as RoutstrModel[];

/** The four TIER_MATRIX ids that no longer existed in the live catalog —
 *  the confirmed root cause of the "cost unavailable" rows. */
const DEAD_TIER_MATRIX_IDS = ['claude-3.5-haiku', 'grok-3-mini', 'grok-4.1-fast', 'grok-4'];

const selectedEntries = (lineup: AiLineup): LineupEntry[] =>
  AI_PROVIDER_IDS.flatMap((p) =>
    AI_TIER_IDS.map((t) => lineup[p][t]).filter((e): e is LineupEntry => e != null)
  );

/** Pinned "now" ≈ the fixture snapshot date (2026-07-02) so the ~18-month
 *  freshness window stays deterministic as the fixture file ages. */
const FIXTURE_NOW = 1_782_950_400;

/** The tier-ranking metric (typical ~8k-prompt / ~2k-completion turn),
 *  recomputed from an entry's compact pricing for ladder assertions. */
const entryTurnCost = (e: LineupEntry): number =>
  (e.satsPricing.request ?? 0) +
  (e.satsPricing.prompt ?? 0) * 8000 +
  (e.satsPricing.completion ?? 0) * 2000;

describe('deriveLineup', () => {
  const { lineup, stats } = deriveLineup(MODELS, FIXTURE_NOW);

  it('fixture predates the dead ids (they must not resurface via a refresh)', () => {
    const fixtureIds = new Set(MODELS.map((m) => m.id));
    for (const dead of DEAD_TIER_MATRIX_IDS) expect(fixtureIds.has(dead)).toBe(false);
    for (const entry of selectedEntries(lineup)) {
      expect(DEAD_TIER_MATRIX_IDS).not.toContain(entry.modelId);
    }
  });

  it('assigns price-ordered tiers: auto = cheapest, pro = median, max = newest of the top price quartile', () => {
    expect(lineup.openai.auto?.modelId).toBe('gpt-5.4-nano');
    expect(lineup.openai.pro?.modelId).toBe('gpt-chat-latest');
    expect(lineup.openai.max?.modelId).toBe('gpt-5.5-pro');

    expect(lineup.claude.auto?.modelId).toBe('claude-haiku-4.5');
    expect(lineup.claude.pro?.modelId).toBe('claude-opus-4.8');
    expect(lineup.claude.max?.modelId).toBe('claude-fable-5');

    expect(lineup.grok.auto?.modelId).toBe('grok-build-0.1');
    expect(lineup.grok.pro?.modelId).toBe('grok-4.20-multi-agent');
    expect(lineup.grok.max?.modelId).toBe('grok-4.20');

    expect(lineup.google.auto?.modelId).toBe('gemma-4-26b-a4b-it');
    expect(lineup.google.pro?.modelId).toBe('gemini-3.1-flash-lite');
    expect(lineup.google.max?.modelId).toBe('gemini-3.5-flash');
  });

  it('the tier ladder is monotone in turn cost for every provider (auto ≤ pro ≤ max)', () => {
    for (const provider of AI_PROVIDER_IDS) {
      const { auto, pro, max } = lineup[provider];
      const ladder = [auto, pro, max].filter((e): e is LineupEntry => e != null);
      for (let i = 1; i < ladder.length; i++) {
        expect(entryTurnCost(ladder[i])).toBeGreaterThanOrEqual(entryTurnCost(ladder[i - 1]));
      }
    }
  });

  it('orders by turn cost, breaking exact price ties by recency then id', () => {
    const base = MODELS.find((m) => m.id === 'grok-4.20')!;
    const mk = (id: string, created: number, priceFactor: number): RoutstrModel => {
      const model: RoutstrModel = {
        ...base,
        id,
        created,
        canonical_slug: `x-ai/${id}`,
        name: `xAI: ${id}`,
        sats_pricing: {
          ...base.sats_pricing,
          prompt: (base.sats_pricing?.prompt ?? 0.001) * priceFactor,
          completion: (base.sats_pricing?.completion ?? 0.002) * priceFactor,
        },
      };
      return model;
    };

    // Distinct price points land cheapest→priciest regardless of recency.
    const { lineup: ladder } = deriveLineup(
      [
        mk('grok-flagship', 1_781_000_000, 10),
        mk('grok-cheap', 1_782_000_000, 0.1),
        mk('grok-mid', 1_780_000_000, 1),
      ],
      FIXTURE_NOW
    );
    expect(ladder.grok.auto?.modelId).toBe('grok-cheap');
    expect(ladder.grok.pro?.modelId).toBe('grok-mid');
    expect(ladder.grok.max?.modelId).toBe('grok-flagship');

    // Exact price tie → newer ranks first; the older twin lands the max slot.
    const { lineup: tied } = deriveLineup(
      [mk('grok-twin-a', 1_780_000_000, 1), mk('grok-twin-b', 1_781_000_000, 1)],
      FIXTURE_NOW
    );
    expect(tied.grok.auto?.modelId).toBe('grok-twin-b');
    expect(tied.grok.max?.modelId).toBe('grok-twin-a');

    // Full tie (price + created) → id asc decides deterministically.
    const { lineup: full } = deriveLineup(
      [mk('grok-twin-b', 1_780_000_000, 1), mk('grok-twin-a', 1_780_000_000, 1)],
      FIXTURE_NOW
    );
    expect(full.grok.auto?.modelId).toBe('grok-twin-a');
  });

  it('freshness window keeps retired ultra-priced relics out of the max slot', () => {
    const base = MODELS.find((m) => m.id === 'grok-4.20')!;
    const relic: RoutstrModel = {
      ...base,
      id: 'grok-relic-pro',
      canonical_slug: 'x-ai/grok-relic-pro',
      created: FIXTURE_NOW - 600 * 24 * 60 * 60, // outside the ~18-month window
      sats_pricing: {
        ...base.sats_pricing,
        prompt: (base.sats_pricing?.prompt ?? 0.001) * 50,
        completion: (base.sats_pricing?.completion ?? 0.002) * 50,
      },
    };
    const grokRows = MODELS.filter((m) => providerIdForModel(m) === 'grok');
    const { lineup: withRelic } = deriveLineup([...grokRows, relic], FIXTURE_NOW);
    expect(withRelic.grok.max?.modelId).not.toBe('grok-relic-pro');
    // With no fresh alternative at all, the relic is still better than an
    // empty row — the window falls back to every qualifying model.
    const { lineup: onlyRelic } = deriveLineup([relic], FIXTURE_NOW);
    expect(onlyRelic.grok.auto?.modelId).toBe('grok-relic-pro');
  });

  it("dedups rolling '~' alias rows in favor of dated concrete siblings, for every provider", () => {
    const ids = selectedEntries(lineup).map((e) => e.modelId);
    for (const alias of [
      'gpt-mini-latest',
      'gpt-latest',
      'claude-fable-latest',
      'claude-haiku-latest',
      'grok-latest',
      'gemini-pro-latest',
      'gemini-flash-latest',
    ]) {
      expect(ids).not.toContain(alias);
    }
    // The alias' concrete twin IS selected (fable pair is byte-identical
    // on pricing/context in the live data).
    expect(ids).toContain('claude-fable-5');
    expect(stats.perProvider.openai.aliasDropped).toBe(2);
    expect(stats.perProvider.claude.aliasDropped).toBe(2);
    expect(stats.perProvider.grok.aliasDropped).toBe(1);
    expect(stats.perProvider.google.aliasDropped).toBe(2);
  });

  it("backstop: every self-declared rolling-redirect row carries the '~' slug marker (fails at fixture refresh if Routstr changes the alias convention)", () => {
    // The dedup keys off canonical_slug's '~' prefix. If Routstr ever stops
    // marking alias rows that way, a refreshed fixture will contain rows
    // whose description still says "redirects to the latest" without the
    // marker — this assertion is the loud failure that prompts a dedup fix
    // (distinct models CAN legitimately share byte-identical pricing, e.g.
    // claude-fable-5 vs claude-opus-4.8-fast, so pricing equality alone
    // cannot be the tripwire).
    const redirectRows = MODELS.filter((m) =>
      (m.description ?? '').toLowerCase().includes('redirects to the latest')
    );
    expect(redirectRows.length).toBeGreaterThanOrEqual(7);
    for (const row of redirectRows) {
      expect(row.canonical_slug?.startsWith('~')).toBe(true);
    }
  });

  it('excludes image-output, embeddings, audio-output, disabled, and tiny-context rows', () => {
    const ids = selectedEntries(lineup).map((e) => e.modelId);
    for (const excluded of [
      'gpt-5.4-image-2', // output_modalities includes image
      'gemini-3-pro-image', // output_modalities includes image
      'gemini-embedding-2', // output embeddings
      'gpt-audio', // output audio
      'gpt-5.4-mini-disabled', // enabled: false
      'gemma4:31b', // 2048 context + no recognised provider identity
    ]) {
      expect(ids).not.toContain(excluded);
    }
  });

  it('never selects models from providers outside the four-tab set', () => {
    const foreign = MODELS.filter((m) => providerIdForModel(m) === null).map((m) => m.id);
    expect(foreign.length).toBeGreaterThan(0);
    const ids = new Set(selectedEntries(lineup).map((e) => e.modelId));
    for (const id of foreign) expect(ids.has(id)).toBe(false);
  });

  it('flags vision input and carries the compact pricing subset (incl. per-image fee)', () => {
    for (const entry of selectedEntries(lineup)) {
      expect(entry.visionInput).toBe(true); // every current-gen selection accepts images
      expect(typeof entry.satsPricing.max_cost).toBe('number');
      expect(typeof entry.satsPricing.prompt).toBe('number');
    }
    // Gemini charges a per-image fee — it must survive into the entry so
    // attachment drafts can price it in.
    const gemini = lineup.google.max!;
    expect(gemini.satsPricing.image).not.toBeNull();
    expect(gemini.displayName).toBe('Gemini 3.5 Flash');
  });

  it('fills partial providers deterministically (2 → max+auto, 1 → auto, 0 → empty row)', () => {
    const twoRow = MODELS.filter((m) => ['grok-build-0.1', 'grok-4.3'].includes(m.id));
    const two = deriveLineup(twoRow, FIXTURE_NOW).lineup.grok;
    // Price-ordered: the cheaper of the pair is Auto, the pricier is Max.
    expect(two.auto?.modelId).toBe('grok-build-0.1');
    expect(two.pro).toBeNull();
    expect(two.max?.modelId).toBe('grok-4.3');

    const one = deriveLineup(
      MODELS.filter((m) => m.id === 'grok-4.3'),
      FIXTURE_NOW
    ).lineup.grok;
    expect(one.max).toBeNull();
    expect(one.pro).toBeNull();
    expect(one.auto?.modelId).toBe('grok-4.3');

    const none = deriveLineup(
      MODELS.filter((m) => providerIdForModel(m) !== 'grok'),
      FIXTURE_NOW
    );
    expect(none.lineup.grok).toEqual({ auto: null, pro: null, max: null });
    // Other providers unaffected by one provider being empty.
    expect(none.lineup.openai.max?.modelId).toBe('gpt-5.5-pro');
  });

  it('never throws and returns an empty lineup for garbage/empty catalogs', () => {
    expect(lineupHasEntries(deriveLineup([]).lineup)).toBe(false);
    expect(lineupHasEntries(deriveLineup(null as unknown as RoutstrModel[]).lineup)).toBe(false);
    const garbage = [
      null,
      42,
      {},
      { id: 7 },
      { id: 'x', name: null, architecture: 'nope', sats_pricing: 'nope' },
    ] as unknown as RoutstrModel[];
    expect(lineupHasEntries(deriveLineup(garbage).lineup)).toBe(false);
  });

  it("recognises no-colon '-latest' display names for grouping (their exclusion is dedup, not a grouping drop)", () => {
    const aliasRow = MODELS.find((m) => m.id === 'claude-haiku-latest')!;
    expect(providerIdForModel(aliasRow)).toBe('claude');
    // Even with the slug stripped, the display-name fallback still groups it.
    const noSlugRow: RoutstrModel = { ...aliasRow, canonical_slug: null };
    expect(providerIdForModel(noSlugRow)).toBe('claude');
  });
});

describe('mergeLineupWithLastKnown', () => {
  const { lineup: full } = deriveLineup(MODELS, FIXTURE_NOW);

  it('substitutes only zero-row providers, marking entries lastKnown', () => {
    const { lineup: withoutGrok } = deriveLineup(
      MODELS.filter((m) => providerIdForModel(m) !== 'grok')
    );
    const merged = mergeLineupWithLastKnown(withoutGrok, full);
    expect(merged.grok.auto?.modelId).toBe('grok-build-0.1');
    expect(merged.grok.auto?.lastKnown).toBe(true);
    // Live providers stay live — no lastKnown marker.
    expect(merged.openai.max?.lastKnown).toBeUndefined();
  });

  it('is a no-op without a last-known lineup and cannot fill from an empty one', () => {
    const { lineup: withoutGrok } = deriveLineup(
      MODELS.filter((m) => providerIdForModel(m) !== 'grok')
    );
    expect(mergeLineupWithLastKnown(withoutGrok, null).grok.auto).toBeNull();
    expect(mergeLineupWithLastKnown(withoutGrok, emptyLineup()).grok.auto).toBeNull();
  });
});

/**
 * The nagg `/app/ai-lineup` payload is the server-curated lineup source that
 * outranks `deriveLineup`. These tests pin the mapping contract: known
 * provider/tier cells land, unknown providers (a future Qwen tab served to
 * newer builds) and unknown tiers are skipped silently, and an all-unknown
 * payload maps to `null` so callers fall back to the client derivation.
 */
describe('lineupFromNaggPayload (server-curated lineup)', () => {
  const payload = NaggAiLineupSchema.parse({
    version: 1,
    updatedAt: 1_751_000_000,
    node: { baseUrl: 'https://api.routstr.com' },
    providers: [
      {
        id: 'claude',
        vendor: 'anthropic',
        models: [
          {
            tier: 'auto',
            id: 'claude-haiku-4.5',
            name: 'Anthropic: Claude Haiku 4.5',
            created: 100,
            contextLength: 200_000,
            maxCompletionTokens: 64_000,
            inputModalities: ['text', 'image'],
            pricing: { prompt: 0.0002, completion: 0.001, request: 0.001, maxCost: 64 },
          },
          {
            tier: 'hyper', // unknown tier → skipped
            id: 'claude-hyper',
            name: 'Anthropic: Hyper',
            created: 100,
            contextLength: 200_000,
            inputModalities: ['text'],
            pricing: { prompt: 1, completion: 1, request: 0, maxCost: 1 },
          },
        ],
      },
      {
        id: 'qwen', // unknown provider (newer-build tab) → skipped
        vendor: 'qwen',
        models: [
          {
            tier: 'auto',
            id: 'qwen-max',
            name: 'Qwen: Max',
            created: 100,
            contextLength: 200_000,
            inputModalities: ['text'],
            pricing: { prompt: 0.001, completion: 0.002, request: 0, maxCost: 10 },
          },
        ],
      },
    ],
  });

  it('maps known provider/tier cells with pricing, vision, and clamp data', () => {
    const { lineup, nodeBaseUrl } = lineupFromNaggPayload(payload);
    expect(nodeBaseUrl).toBe('https://api.routstr.com');
    expect(lineup).not.toBeNull();
    const entry = lineup!.claude.auto!;
    expect(entry.modelId).toBe('claude-haiku-4.5');
    expect(entry.displayName).toBe('Claude Haiku 4.5'); // provider prefix stripped
    expect(entry.visionInput).toBe(true);
    expect(entry.maxCompletionTokens).toBe(64_000);
    expect(entry.satsPricing.max_cost).toBe(64);
    expect(entry.satsPricing.completion).toBe(0.001);
  });

  it('skips unknown providers and tiers without failing the payload', () => {
    const { lineup } = lineupFromNaggPayload(payload);
    expect(lineup!.claude.pro).toBeNull(); // 'hyper' tier dropped
    expect(lineup!.openai.auto).toBeNull();
    expect(lineup!.grok.auto).toBeNull();
  });

  it('returns a null lineup when no known provider carried a model', () => {
    const { lineup, nodeBaseUrl } = lineupFromNaggPayload(
      NaggAiLineupSchema.parse({
        version: 1,
        updatedAt: 0,
        node: { baseUrl: '' },
        providers: [{ id: 'deepseek', vendor: 'deepseek', models: [] }],
      })
    );
    expect(lineup).toBeNull();
    expect(nodeBaseUrl).toBeNull();
  });
});
