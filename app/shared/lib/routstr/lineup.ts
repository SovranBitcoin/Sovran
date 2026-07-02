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
 * recent it is. Guards against tiny/toy releases outranking real models
 * under the recency-first ordering.
 */
const MIN_CONTEXT_LENGTH = 16_000;

/** Lineup depth per provider: Auto / Pro / Max. */
const MAX_PER_PROVIDER = 3;

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

export const AiLineupSchema = z.object({
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
 * Chat-capability qualification: enabled, priced, text-only output (a
 * naive top-by-recency otherwise selects image-generation and embedding
 * models — `gemini-3-pro-image`, `gemini-embedding-2`), and a context
 * window large enough for a typical turn.
 */
function isChatCapable(model: RoutstrModel): boolean {
  if (model.enabled !== true) return false;
  if (model.sats_pricing == null || typeof model.sats_pricing !== 'object') return false;
  const out = model.architecture?.output_modalities;
  if (!Array.isArray(out) || !out.includes('text')) return false;
  if (out.includes('image') || out.includes('embeddings') || out.includes('audio')) return false;
  const ctx = model.context_length;
  if (typeof ctx !== 'number' || ctx < MIN_CONTEXT_LENGTH) return false;
  return true;
}

/**
 * Capability ordering — the ONE documented ordering used for both top-3
 * selection and tier assignment. The catalog carries no benchmark field,
 * so recency (`created` desc) is the primary capability proxy, context
 * length desc the secondary, and the id an alphabetical final tie-break
 * so exact created+context ties (observed in the live catalog) resolve
 * deterministically.
 */
function byCapability(a: RoutstrModel, b: RoutstrModel): number {
  const createdA = typeof a.created === 'number' ? a.created : 0;
  const createdB = typeof b.created === 'number' ? b.created : 0;
  if (createdA !== createdB) return createdB - createdA;
  const ctxA = typeof a.context_length === 'number' ? a.context_length : 0;
  const ctxB = typeof b.context_length === 'number' ? b.context_length : 0;
  if (ctxA !== ctxB) return ctxB - ctxA;
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
  };
}

/**
 * Assign the ranked top-N to tiers from the SAME capability ordering:
 * Max = rank 1 (most capable / newest), Pro = rank 2, Auto = rank 3.
 * Partial providers fill deterministically: 2 models → Max + Auto,
 * 1 model → Auto only, 0 → all cells null (the provider tab still
 * renders, with whatever rows exist). Live per-row cost display carries
 * the price signal the old cheapest→premium ladder used to encode.
 */
function assignTiers(ranked: LineupEntry[]): ProviderLineup {
  const [first, second, third] = ranked;
  if (third) return { max: first, pro: second, auto: third };
  if (second) return { max: first, pro: null, auto: second };
  if (first) return { max: null, pro: null, auto: first };
  return emptyProviderLineup();
}

/**
 * Derive the (provider × tier) lineup from a raw catalog. Pure and
 * total — never throws, returns an empty lineup for garbage input.
 */
export function deriveLineup(models: RoutstrModel[]): { lineup: AiLineup; stats: LineupStats } {
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
    const candidates = (byProvider.get(provider) ?? []).sort(byCapability);
    stats.perProvider[provider].qualifying = candidates.length;
    stats.totalQualifying += candidates.length;
    lineup[provider] = assignTiers(candidates.slice(0, MAX_PER_PROVIDER).map(toLineupEntry));
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
