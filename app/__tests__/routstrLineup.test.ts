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
  deriveLineup,
  emptyLineup,
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

describe('deriveLineup', () => {
  const { lineup, stats } = deriveLineup(MODELS);

  it('fixture predates the dead ids (they must not resurface via a refresh)', () => {
    const fixtureIds = new Set(MODELS.map((m) => m.id));
    for (const dead of DEAD_TIER_MATRIX_IDS) expect(fixtureIds.has(dead)).toBe(false);
    for (const entry of selectedEntries(lineup)) {
      expect(DEAD_TIER_MATRIX_IDS).not.toContain(entry.modelId);
    }
  });

  it('selects the documented top-3 per provider (created desc → context desc → id)', () => {
    expect(lineup.openai.max?.modelId).toBe('gpt-chat-latest');
    expect(lineup.openai.pro?.modelId).toBe('gpt-5.5-pro'); // created 3s after gpt-5.5
    expect(lineup.openai.auto?.modelId).toBe('gpt-5.5');

    expect(lineup.claude.max?.modelId).toBe('claude-sonnet-5');
    expect(lineup.claude.pro?.modelId).toBe('claude-fable-5');
    expect(lineup.claude.auto?.modelId).toBe('claude-opus-4.8-fast');

    expect(lineup.grok.max?.modelId).toBe('grok-build-0.1');
    expect(lineup.grok.pro?.modelId).toBe('grok-4.3');
    expect(lineup.grok.auto?.modelId).toBe('grok-4.20-multi-agent'); // created 139s after grok-4.20

    expect(lineup.google.max?.modelId).toBe('gemini-3.5-flash');
    expect(lineup.google.pro?.modelId).toBe('gemini-3.1-flash-lite');
    expect(lineup.google.auto?.modelId).toBe('gemma-4-26b-a4b-it');
  });

  it('resolves exact created ties by context desc, then id asc', () => {
    // Synthetic exact tie: strip the 139s created gap between the grok-4.20
    // pair so the alphabetical final tie-break is actually exercised.
    const tied = MODELS.filter((m) => m.id.startsWith('grok-4.20')).map((m) => ({
      ...m,
      created: 1_774_979_019,
    })) as RoutstrModel[];
    const { lineup: tiedLineup } = deriveLineup(tied);
    // Identical created + context → 'grok-4.20' < 'grok-4.20-multi-agent'.
    expect(tiedLineup.grok.max?.modelId).toBe('grok-4.20');
    expect(tiedLineup.grok.auto?.modelId).toBe('grok-4.20-multi-agent');
    // Context desc beats id when created ties.
    const ctxTied = tied.map((m, i) => ({ ...m, context_length: i === 0 ? 500_000 : 2_000_000 }));
    const { lineup: ctxLineup } = deriveLineup(ctxTied as RoutstrModel[]);
    expect(ctxLineup.grok.max?.contextLength).toBe(2_000_000);
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
    const two = deriveLineup(twoRow).lineup.grok;
    expect(two.max?.modelId).toBe('grok-build-0.1');
    expect(two.pro).toBeNull();
    expect(two.auto?.modelId).toBe('grok-4.3');

    const one = deriveLineup(MODELS.filter((m) => m.id === 'grok-4.3')).lineup.grok;
    expect(one.max).toBeNull();
    expect(one.pro).toBeNull();
    expect(one.auto?.modelId).toBe('grok-4.3');

    const none = deriveLineup(MODELS.filter((m) => providerIdForModel(m) !== 'grok'));
    expect(none.lineup.grok).toEqual({ auto: null, pro: null, max: null });
    // Other providers unaffected by one provider being empty.
    expect(none.lineup.openai.max?.modelId).toBe('gpt-chat-latest');
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
  const { lineup: full } = deriveLineup(MODELS);

  it('substitutes only zero-row providers, marking entries lastKnown', () => {
    const { lineup: withoutGrok } = deriveLineup(
      MODELS.filter((m) => providerIdForModel(m) !== 'grok')
    );
    const merged = mergeLineupWithLastKnown(withoutGrok, full);
    expect(merged.grok.max?.modelId).toBe('grok-build-0.1');
    expect(merged.grok.max?.lastKnown).toBe(true);
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
