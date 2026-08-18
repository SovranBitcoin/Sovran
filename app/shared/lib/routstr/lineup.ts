import { z } from 'zod';
import type { RoutstrModel } from './api';

/**
 * Dynamic AI-tab model lineup, derived from the live Routstr `/v1/models`
 * catalog. Replaces the hand-maintained `TIER_MATRIX` that rotted as the
 * catalog drifted (4 of its 9 hardcoded ids no longer existed, which is
 * what rendered "cost unavailable" in the picker).
 *
 * This module is the single seam between the raw catalog and every lineup
 * consumer (the picker, the chip, the send path, and the persisted
 * last-known snapshot in `routstrStore`). It lives in `shared/lib/routstr`
 * — not `features/ai` — because `routstrStore` persists the derived lineup
 * and shared stores must not import from features.
 *
 * `deriveLineup` is pure and total: any input, including a garbage or
 * empty catalog, produces a (possibly empty) lineup without throwing.
 */

/**
 * Provider / tier id unions. Single source of truth — `features/ai/lib/
 * format.ts` (UI metadata) and `routstrStore` (selection guards) both
 * import these, which is what keeps the two ends of the (provider, tier)
 * selection contract in lockstep by construction.
 */
export const AI_PROVIDER_IDS = ['openai', 'claude', 'grok', 'google'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_TIER_IDS = ['auto', 'pro', 'max'] as const;
export type AiTierId = (typeof AI_TIER_IDS)[number];

/**
 * Minimum context window for a model to qualify for the lineup. The
 * affordability estimate assumes a typical turn of ~8k prompt + ~2k
 * completion tokens (see `format.ts`); a model that cannot comfortably
 * hold that plus history is not usable as a chat daily-driver, however
 * cheap or recent it is. Guards against tiny/toy releases entering the
 * ladder (they'd otherwise dominate the cheap end).
 */
const MIN_CONTEXT_LENGTH = 16_000;

/**
 * Freshness window for automatic tier picks (~18 months), mirroring nagg's
 * `aiLineupFreshWindow`. Catalogs keep retired premium relics listed
 * (o1-pro class, ~4× the current flagship's price) and the price-ordered
 * Max pick must not land on those over the real flagship.
 */
const FRESH_WINDOW_SECONDS = 548 * 24 * 60 * 60;

/**
 * Compact per-model pricing subset carried into the lineup (and persisted
 * with it). Field names match the catalog's `sats_pricing` so the pricing
 * helpers in `format.ts` work identically against a live catalog row or a
 * persisted lineup entry. `image` is the per-image fee some vision models
 * (notably Gemini) charge.
 */
const LineupPricingSchema = z.object({
  prompt: z.number().nullable().catch(null),
  completion: z.number().nullable().catch(null),
  request: z.number().nullable().catch(null),
  image: z.number().nullable().catch(null),
  max_cost: z.number().nullable().catch(null),
});
export type LineupPricing = z.infer<typeof LineupPricingSchema>;

const LineupEntrySchema = z.object({
  modelId: z.string().max(256),
  /** Catalog `name` with the `Provider:` prefix stripped. */
  displayName: z.string().max(256),
  contextLength: z.number().int().nonnegative().catch(0),
  created: z.number().int().nonnegative().catch(0),
  /** Model accepts image input — gates the composer's image attach. */
  visionInput: z.boolean().catch(false),
  satsPricing: LineupPricingSchema,
  /**
   * Model's completion-token ceiling (`top_provider.max_completion_tokens`),
   * used to clamp the `max_tokens` sent with each request below the model's
   * own limit. Additive + tolerant: absent on lineups persisted before this
   * field existed, in which case the send path uses the default clamp.
   */
  maxCompletionTokens: z.number().int().positive().nullable().catch(null).optional(),
  /**
   * True when this entry was substituted from the persisted last-known
   * lineup because a successful fetch returned zero qualifying models for
   * its provider. Rendered as a "last known" annotation; the id may be
   * dead on the API, which the send-path candidate chain absorbs.
   */
  lastKnown: z.boolean().optional(),
});
export type LineupEntry = z.infer<typeof LineupEntrySchema>;

const ProviderLineupSchema = z.object({
  auto: LineupEntrySchema.nullable().catch(null),
  pro: LineupEntrySchema.nullable().catch(null),
  max: LineupEntrySchema.nullable().catch(null),
});
type ProviderLineup = z.infer<typeof ProviderLineupSchema>;

const AiLineupSchema = z.object({
  openai: ProviderLineupSchema,
  claude: ProviderLineupSchema,
  grok: ProviderLineupSchema,
  google: ProviderLineupSchema,
});
export type AiLineup = z.infer<typeof AiLineupSchema>;

/**
 * Persisted last-known lineup snapshot — the offline fallback that keeps
 * the model menu functional when the catalog fetch fails. Compact by
 * construction (≤12 entries), tolerant per field so one malformed value
 * can never fail the parse and take the whole `routstr-store` blob (which
 * holds the apiKey and sessions) down with it.
 */
export const PersistedLineupSchema = z.object({
  derivedAt: z.number().int().nonnegative().catch(0),
  lineup: AiLineupSchema,
});
export type PersistedLineup = z.infer<typeof PersistedLineupSchema>;

interface LineupProviderStats {
  qualifying: number;
  aliasDropped: number;
}

interface LineupStats {
  perProvider: Record<AiProviderId, LineupProviderStats>;
  totalQualifying: number;
}

const emptyProviderLineup = (): ProviderLineup => ({ auto: null, pro: null, max: null });

export const emptyLineup = (): AiLineup => ({
  openai: emptyProviderLineup(),
  claude: emptyProviderLineup(),
  grok: emptyProviderLineup(),
  google: emptyProviderLineup(),
});

/** True when at least one cell anywhere in the lineup is filled. */
export function lineupHasEntries(lineup: AiLineup): boolean {
  return AI_PROVIDER_IDS.some((p) => providerHasEntries(lineup[p]));
}

function providerHasEntries(provider: ProviderLineup): boolean {
  return AI_TIER_IDS.some((t) => provider[t] != null);
}

/**
 * Map a catalog slug/name prefix onto our provider ids. The catalog's
 * `canonical_slug` prefixes are the most structured identity signal
 * (`openai/…`, `anthropic/…`, `x-ai/…`, `google/…`); display-name
 * prefixes cover the rows without a slug, including the no-colon alias
 * rows ("Anthropic Claude Haiku Latest").
 */
const SLUG_PREFIX_TO_PROVIDER: Record<string, AiProviderId> = {
  openai: 'openai',
  anthropic: 'claude',
  'x-ai': 'grok',
  xai: 'grok',
  google: 'google',
};

const NAME_PREFIX_TO_PROVIDER: [string, AiProviderId][] = [
  ['openai', 'openai'],
  ['anthropic', 'claude'],
  ['claude', 'claude'],
  ['xai', 'grok'],
  ['grok', 'grok'],
  ['google', 'google'],
  ['gemini', 'google'],
];

/**
 * Resolve which of our four providers a catalog row belongs to, or `null`
 * for everyone else (Qwen, Mistral, DeepSeek, …), who never enter the
 * lineup. Slug prefix wins; the display-name fallback deliberately
 * recognises alias rows so their later exclusion is an explicit dedup
 * decision, not an accidental grouping drop.
 */
export function providerIdForModel(model: RoutstrModel): AiProviderId | null {
  const slug = typeof model.canonical_slug === 'string' ? model.canonical_slug : '';
  if (slug) {
    // '~' marks a rolling alias slug ('~anthropic/claude-fable-latest').
    const slashIdx = slug.indexOf('/');
    if (slashIdx > 0) {
      const prefix = slug.slice(0, slashIdx).replace(/^~/, '').toLowerCase();
      const bySlug = SLUG_PREFIX_TO_PROVIDER[prefix];
      if (bySlug !== undefined) return bySlug;
    }
  }
  const name = typeof model.name === 'string' ? model.name.toLowerCase() : '';
  if (!name) return null;
  for (const [prefix, provider] of NAME_PREFIX_TO_PROVIDER) {
    if (name.startsWith(prefix)) return provider;
  }
  return null;
}

/** Rolling alias rows redirect to "the latest model in the family" and
 *  duplicate their dated concrete sibling byte-for-byte on pricing —
 *  keeping both would waste a lineup slot on the same backing model. */
function isRollingAlias(model: RoutstrModel): boolean {
  return typeof model.canonical_slug === 'string' && model.canonical_slug.startsWith('~');
}

/**
 * Chat-capability qualification: enabled, priced (a positive completion
 * rate — embedding rows price prompt-only), text-only output (image
 * generators and embedding models must never enter — `gemini-3-pro-image`,
 * `gemini-embedding-2`), and a context window large enough for a typical
 * turn. Mirrors nagg's `qualifiesForAILineup`.
 */
function isChatCapable(model: RoutstrModel): boolean {
  if (model.enabled !== true) return false;
  const p = model.sats_pricing;
  if (p == null || typeof p !== 'object') return false;
  if (!(typeof p.completion === 'number' && p.completion > 0)) return false;
  if (!(typeof p.max_cost === 'number' && p.max_cost > 0)) return false;
  const out = model.architecture?.output_modalities;
  if (!Array.isArray(out) || !out.includes('text')) return false;
  if (out.includes('image') || out.includes('embeddings') || out.includes('audio')) return false;
  const ctx = model.context_length;
  if (typeof ctx !== 'number' || ctx < MIN_CONTEXT_LENGTH) return false;
  return true;
}

/**
 * Tier-ranking metric — the sats cost of a typical turn (~8k prompt / ~2k
 * completion tokens), the same shape as `format.ts`'s per-turn estimate
 * and nagg's `aiTurnCost`. Within one vendor this tracks the
 * cheap→flagship capability ladder well.
 */
function turnCostSats(model: RoutstrModel): number {
  const p = model.sats_pricing;
  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
  return num(p?.request) + num(p?.prompt) * 8000 + num(p?.completion) * 2000;
}

/**
 * Price ordering — the ONE documented ordering for tier assignment:
 * turn cost asc (the tier ladder IS the price ladder), recency desc so
 * same-priced siblings resolve toward the current release, id asc as the
 * deterministic final tie-break.
 */
function byTurnCost(a: RoutstrModel, b: RoutstrModel): number {
  const costA = turnCostSats(a);
  const costB = turnCostSats(b);
  if (costA !== costB) return costA - costB;
  const createdA = typeof a.created === 'number' ? a.created : 0;
  const createdB = typeof b.created === 'number' ? b.created : 0;
  if (createdA !== createdB) return createdB - createdA;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Catalog `name` with the `Provider:` prefix stripped — same rule as
 *  `format.ts#getModelDisplayName`, precomputed so persisted entries can
 *  render offline without a catalog row to look up. */
function displayNameFor(model: RoutstrModel): string {
  const raw = typeof model.name === 'string' ? model.name.trim() : '';
  if (!raw) return model.id;
  const colonIdx = raw.indexOf(':');
  if (colonIdx >= 0 && colonIdx < raw.length - 1) return raw.slice(colonIdx + 1).trim();
  return raw;
}

function toLineupEntry(model: RoutstrModel): LineupEntry {
  const p = model.sats_pricing;
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
  const maxCompletion = model.top_provider?.max_completion_tokens;
  return {
    modelId: model.id,
    displayName: displayNameFor(model),
    contextLength: typeof model.context_length === 'number' ? model.context_length : 0,
    created: typeof model.created === 'number' ? model.created : 0,
    visionInput:
      Array.isArray(model.architecture?.input_modalities) &&
      model.architecture.input_modalities.includes('image'),
    satsPricing: {
      prompt: num(p?.prompt),
      completion: num(p?.completion),
      request: num(p?.request),
      image: num(p?.image),
      max_cost: num(p?.max_cost),
    },
    maxCompletionTokens:
      typeof maxCompletion === 'number' && maxCompletion > 0 ? Math.floor(maxCompletion) : null,
  };
}

/**
 * Price-tier assignment, mirroring nagg's `pickAITiers` so the fallback
 * derivation and the server-curated lineup agree on what the tiers MEAN:
 *
 *   - Auto — the cheapest qualifying model (affordable everyday chat).
 *   - Pro  — the median of the price ladder.
 *   - Max  — the NEWEST model in the top price quartile. Price alone
 *     picks retired ultra-priced relics (o1-pro class); recency alone
 *     picks whatever was listed last. Price finds the premium band,
 *     listing recency finds the current flagship in it.
 *
 * Automatic picks only consider models inside the freshness window
 * (falling back to all qualifying rows when a provider lists nothing
 * fresh). Partial providers fill deterministically: 2 models →
 * Auto + Max, 1 → Auto only, 0 → all cells null.
 */
function pickTiers(candidates: RoutstrModel[], nowSeconds: number): ProviderLineup {
  if (candidates.length === 0) return emptyProviderLineup();
  const cutoff = nowSeconds - FRESH_WINDOW_SECONDS;
  let fresh = candidates.filter((m) => (typeof m.created === 'number' ? m.created : 0) >= cutoff);
  if (fresh.length === 0) fresh = candidates;
  const ranked = [...fresh].sort(byTurnCost);

  const auto = ranked[0];
  let pro: RoutstrModel | null = null;
  let max: RoutstrModel | null = null;
  if (ranked.length >= 2) {
    const quartile = ranked.slice(Math.max(1, Math.floor((ranked.length * 3) / 4)));
    max = quartile.reduce((newest, m) =>
      (typeof m.created === 'number' ? m.created : 0) >
      (typeof newest.created === 'number' ? newest.created : 0)
        ? m
        : newest
    );
  }
  if (ranked.length >= 3) pro = ranked[Math.floor(ranked.length / 2)];

  return {
    auto: toLineupEntry(auto),
    pro: pro ? toLineupEntry(pro) : null,
    max: max ? toLineupEntry(max) : null,
  };
}

/**
 * Derive the (provider × tier) lineup from a raw catalog. Pure and
 * total — never throws, returns an empty lineup for garbage input.
 * `nowSeconds` is injectable so tests pin the freshness window.
 */
export function deriveLineup(
  models: RoutstrModel[],
  nowSeconds: number = Math.floor(Date.now() / 1000)
): { lineup: AiLineup; stats: LineupStats } {
  const lineup = emptyLineup();
  const stats: LineupStats = {
    perProvider: {
      openai: { qualifying: 0, aliasDropped: 0 },
      claude: { qualifying: 0, aliasDropped: 0 },
      grok: { qualifying: 0, aliasDropped: 0 },
      google: { qualifying: 0, aliasDropped: 0 },
    },
    totalQualifying: 0,
  };
  if (!Array.isArray(models)) return { lineup, stats };

  const byProvider = new Map<AiProviderId, RoutstrModel[]>();
  for (const model of models) {
    if (!model || typeof model !== 'object' || typeof model.id !== 'string') continue;
    const provider = providerIdForModel(model);
    if (!provider) continue;
    if (!isChatCapable(model)) continue;
    if (isRollingAlias(model)) {
      // Deliberate within-provider dedup: prefer the dated concrete
      // sibling over the rolling '-latest' alias of the same model.
      stats.perProvider[provider].aliasDropped++;
      continue;
    }
    const list = byProvider.get(provider) ?? [];
    list.push(model);
    byProvider.set(provider, list);
  }

  for (const provider of AI_PROVIDER_IDS) {
    const candidates = byProvider.get(provider) ?? [];
    stats.perProvider[provider].qualifying = candidates.length;
    stats.totalQualifying += candidates.length;
    lineup[provider] = pickTiers(candidates, nowSeconds);
  }

  return { lineup, stats };
}

/**
 * Per-provider graceful degradation: when a successful fetch yields zero
 * qualifying models for a provider (catalog drift — the exact failure
 * class that produced "cost unavailable"), substitute that provider's
 * block from the persisted last-known lineup, marking its entries so the
 * picker can annotate them. A substituted id may be dead on the API; the
 * send-path candidate chain and failed-send popup absorb that.
 */
/**
 * nagg's `GET /app/ai-lineup` payload — the server-curated lineup that takes
 * precedence over the client-side derivation. Serving the lineup from nagg
 * makes the model set, tier picks (via `NAGG_AI_LINEUP_PINS`), and even the
 * Routstr node base URL updatable for already-shipped builds by a nagg
 * deploy alone. Envelope is permissive (Postel's Law): unknown provider ids
 * and extra fields are skipped, malformed models drop individually.
 */
const NaggLineupModelSchema = z.object({
  tier: z.string().max(32),
  id: z.string().max(256),
  name: z.string().max(256).catch(''),
  created: z.number().int().nonnegative().catch(0),
  contextLength: z.number().int().nonnegative().catch(0),
  maxCompletionTokens: z.number().int().positive().nullable().catch(null).optional(),
  inputModalities: z.array(z.string().max(32)).max(16).catch([]),
  pricing: z
    .object({
      prompt: z.number().nullable().catch(null),
      completion: z.number().nullable().catch(null),
      request: z.number().nullable().catch(null),
      image: z.number().nullable().catch(null).optional(),
      maxCost: z.number().nullable().catch(null),
    })
    .partial()
    .catch({}),
});

export const NaggAiLineupSchema = z.object({
  version: z.number().int().catch(1),
  updatedAt: z.number().int().nonnegative().catch(0),
  node: z.object({ baseUrl: z.string().max(512).catch('') }).catch({ baseUrl: '' }),
  providers: z
    .array(
      z.object({
        id: z.string().max(64),
        vendor: z.string().max(64).catch(''),
        models: z.array(NaggLineupModelSchema).max(16).catch([]),
      })
    )
    .max(64)
    .catch([]),
});
type NaggAiLineup = z.infer<typeof NaggAiLineupSchema>;

/**
 * Map the nagg payload onto the app's `AiLineup` shape. Providers the app
 * doesn't know (a future Qwen/DeepSeek tab served to newer builds) and tiers
 * outside auto/pro/max are skipped — old builds stay correct on a newer
 * payload by construction. Returns a `null` lineup when no known provider
 * carried any model so callers fall back to the client-side derivation.
 */
export function lineupFromNaggPayload(payload: NaggAiLineup): {
  lineup: AiLineup | null;
  nodeBaseUrl: string | null;
} {
  const lineup = emptyLineup();
  const knownProviders = new Set<string>(AI_PROVIDER_IDS);
  const knownTiers = new Set<string>(AI_TIER_IDS);
  let filled = 0;
  for (const provider of payload.providers) {
    if (!knownProviders.has(provider.id)) continue;
    const providerId = provider.id as AiProviderId;
    for (const model of provider.models) {
      if (!knownTiers.has(model.tier)) continue;
      const tier = model.tier as AiTierId;
      lineup[providerId][tier] = {
        modelId: model.id,
        displayName: stripProviderPrefix(model.name) || model.id,
        contextLength: model.contextLength,
        created: model.created,
        visionInput: model.inputModalities?.includes('image') ?? false,
        satsPricing: {
          prompt: model.pricing?.prompt ?? null,
          completion: model.pricing?.completion ?? null,
          request: model.pricing?.request ?? null,
          image: model.pricing?.image ?? null,
          max_cost: model.pricing?.maxCost ?? null,
        },
        maxCompletionTokens: model.maxCompletionTokens ?? null,
      };
      filled++;
    }
  }
  const nodeBaseUrl = payload.node.baseUrl.trim() || null;
  return { lineup: filled > 0 ? lineup : null, nodeBaseUrl };
}

/** Same `Provider:` prefix strip as `displayNameFor`, for nagg names. */
function stripProviderPrefix(raw: string): string {
  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx >= 0 && colonIdx < trimmed.length - 1) return trimmed.slice(colonIdx + 1).trim();
  return trimmed;
}

export function mergeLineupWithLastKnown(
  derived: AiLineup,
  lastKnown: AiLineup | null | undefined
): AiLineup {
  if (!lastKnown) return derived;
  const merged = { ...derived };
  for (const provider of AI_PROVIDER_IDS) {
    if (providerHasEntries(derived[provider])) continue;
    const fallback = lastKnown[provider];
    if (!fallback || !providerHasEntries(fallback)) continue;
    const marked = emptyProviderLineup();
    for (const tier of AI_TIER_IDS) {
      const entry = fallback[tier];
      marked[tier] = entry ? { ...entry, lastKnown: true } : null;
    }
    merged[provider] = marked;
  }
  return merged;
}
