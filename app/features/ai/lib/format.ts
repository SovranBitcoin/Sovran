import type { RoutstrModel } from '@/shared/lib/routstr/api';
import {
  AI_PROVIDER_IDS,
  AI_TIER_IDS,
  type AiLineup,
  type AiProviderId,
  type AiTierId,
  type LineupEntry,
  type LineupPricing,
} from '@/shared/lib/routstr/lineup';

/**
 * Model picker shown in the AI tab. The picker is a providers × tiers
 * matrix: four providers (OpenAI, Claude, Grok, Google) crossed with three
 * quality tiers (Auto, Pro, Max). The user picks a (provider, tier) pair
 * via the menu — tabs at the top of the sheet are providers, rows under
 * each tab are tiers — and the runtime resolves that pair to a model id
 * against the DYNAMIC lineup derived from the live `/v1/models` catalog
 * (see `shared/lib/routstr/lineup.ts`).
 *
 * There is deliberately no hardcoded model-id table here anymore. The old
 * `TIER_MATRIX` rotted as the catalog drifted (4 of its 9 ids stopped
 * existing, rendering "cost unavailable" rows), and its stated intent —
 * "retune the lineup without a persisted migration" — is preserved by the
 * derivation: the persisted state is still just a (provider id, tier id)
 * pair, never a model id. Pricing is NEVER hardcoded — every sat figure
 * rendered to the user is read from the catalog's `sats_pricing` (or the
 * persisted lineup snapshot's compact copy of it) at display time.
 *
 * Tier intent under the capability ordering (see `deriveLineup`):
 *   - Max  — rank 1: the provider's newest / most capable model.
 *   - Pro  — rank 2.
 *   - Auto — rank 3: the accessible daily-driver end of the top-3.
 * Per-row live cost display carries the price signal the old
 * cheapest→premium ladder used to encode.
 */

export interface AiProvider {
  id: AiProviderId;
  /** Tab label shown in the picker's anchor pill. */
  label: string;
  /** Iconify glyph for the tab anchor. Resolved against the registry in
   *  `assets/icons/index.tsx`. */
  icon: string;
}

export interface AiTier {
  id: AiTierId;
  /** Row label inside a provider tab (and the chip's left half). */
  label: string;
  description: string;
  /** Iconify glyph for the tier row. */
  icon: string;
}

/** Ordered to match `AI_PROVIDER_IDS` — the provider-id union and this
 *  display metadata stay in lockstep by construction (same source array). */
export const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI', icon: 'ri:openai-fill' },
  { id: 'claude', label: 'Claude', icon: 'ri:anthropic-fill' },
  { id: 'grok', label: 'Grok', icon: 'ri:twitter-x-fill' },
  { id: 'google', label: 'Google', icon: 'ri:google-fill' },
] as const;

export const AI_TIERS: readonly AiTier[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Affordable everyday chat',
    icon: 'mdi:robot',
  },
  {
    id: 'pro',
    label: 'Pro',
    description: 'Frontier reasoning at low latency',
    icon: 'mingcute:lightning-fill',
  },
  {
    id: 'max',
    label: 'Max',
    description: 'Most intelligent — for code and deeper reasoning',
    icon: 'ic:round-star',
  },
] as const;

const DEFAULT_PROVIDER_ID: AiProviderId = 'openai';

/** Default tier on app start — also the fallback when a stale (provider,
 *  tier) pair somehow names an id we don't recognise. */
const DEFAULT_TIER_ID: AiTierId = 'auto';

/** Generic glyph used wherever we want to mean "Auto" outside the tier
 *  ladder (e.g. the 402 "Switch to Auto" button). Distinct from the Auto
 *  tier's own icon so the chip's fallback doesn't mimic a tier glyph. */
export const AUTO_ICON = 'mdi:brain';

const PROVIDER_BY_ID = new Map<AiProviderId, AiProvider>(
  AI_PROVIDERS.map((p) => [p.id, p] as const)
);
const TIER_BY_ID = new Map<AiTierId, AiTier>(AI_TIERS.map((t) => [t.id, t] as const));

/**
 * Multiplier applied to `max_cost` when computing the affordability gate.
 * Kept at 1.0: Routstr's `max_cost` is already the absolute upper bound it
 * will reserve from the balance, so any client-side multiplier > 1 just
 * produces false-negative "Top up X sats" indicators for tiers the API
 * would happily accept. Surfaced (and exported) so the diagnostic logs
 * can quote it next to `max_cost`.
 */
export const AFFORD_BUFFER = 1.0;

/**
 * Typical chat-turn input size used to estimate cost from per-token
 * pricing. Chat messages and surrounding context together rarely exceed
 * ~8k prompt tokens; bumping this up just makes the affordability gate
 * artificially tight for short conversations (which are the overwhelming
 * majority of usage).
 */
const TYPICAL_PROMPT_TOKENS = 8000;

/**
 * Typical chat-turn output size. We default to "the assistant writes a
 * couple of paragraphs". Models that yield long-form output (code, deep
 * reasoning) can burn more, but the post-stream `actualCostSats` log
 * gives us the data to retune this if we see drift.
 */
const TYPICAL_COMPLETION_TOKENS = 2000;

function pricingForModel(modelId: string, models: RoutstrModel[]): LineupPricing | null {
  const model = models.find((m) => m.id === modelId);
  const p = model?.sats_pricing;
  if (!p) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    prompt: num(p.prompt),
    completion: num(p.completion),
    request: num(p.request),
    image: num(p.image),
    max_cost: num(p.max_cost),
  };
}

/**
 * Estimate a realistic worst-case cost for ONE chat turn, in whole sats,
 * from a compact pricing record — works identically against a live catalog
 * row (`sats_pricing`) or a persisted lineup entry, which is what keeps
 * the picker's cost column alive offline.
 *
 * `request` (per-call fee) + `prompt` × `TYPICAL_PROMPT_TOKENS` +
 * `completion` × `TYPICAL_COMPLETION_TOKENS` + `image` × `imageCount`
 * (the per-image fee some vision models charge — attachment drafts on
 * Gemini are systematically undercounted without it).
 *
 * Why not `max_cost`? `max_cost` is "fill the entire context window with
 * the most expensive token mix". For a 400k-token context that works out
 * to ~84 sats where a real turn costs ~0.2 sats; gating the affordability
 * indicator on it produced "Top up X sats" banners on tiers the user
 * could fund 100+ messages against.
 *
 * Falls back to `max_cost / 100` (a ~hundredth of the worst case is a
 * reasonable typical-turn ballpark) when per-token pricing is missing,
 * and to `null` when pricing is unknown entirely so the caller can
 * short-circuit to "always affordable until proven otherwise".
 */
export function estimateTurnCostSatsFromPricing(
  pricing: LineupPricing | null,
  imageCount = 0
): number | null {
  if (!pricing) return null;
  const imageFee = typeof pricing.image === 'number' ? pricing.image * imageCount : 0;
  if (pricing.prompt != null && pricing.completion != null) {
    return (
      (pricing.request ?? 0) +
      pricing.prompt * TYPICAL_PROMPT_TOKENS +
      pricing.completion * TYPICAL_COMPLETION_TOKENS +
      imageFee
    );
  }
  if (pricing.max_cost != null) {
    return pricing.max_cost / 100 + imageFee;
  }
  return null;
}

/** Catalog-keyed variant of `estimateTurnCostSatsFromPricing` for the send
 *  path, which always works against live `RoutstrModel[]` rows. */
export function estimateTurnCostSats(
  modelId: string,
  models: RoutstrModel[],
  imageCount = 0
): number | null {
  return estimateTurnCostSatsFromPricing(pricingForModel(modelId, models), imageCount);
}

/**
 * Approximate count of additional turns the user could send against this
 * pricing before Routstr's `max_cost` reservation gate starts rejecting.
 * Two limits are at play:
 *
 *   1. Each turn drops the balance by the estimated per-turn spend.
 *   2. Each request requires `balance >= max_cost` upfront — once the
 *      balance drifts below that ceiling, the next send fails with 402
 *      regardless of how cheap the typical turn is.
 *
 * The formula bakes both in: `floor((balance − max_cost) / typical) + 1`
 * is the number of consecutive sends you could queue starting from
 * `balanceSats` before the reservation gate trips. Returns `null` when
 * cost data is unavailable, and `0` when balance is already below the
 * reservation floor.
 */
export function estimateMessagesRemainingFromPricing(
  balanceSats: number,
  pricing: LineupPricing | null
): number | null {
  const max = pricing?.max_cost ?? null;
  const typical = estimateTurnCostSatsFromPricing(pricing);
  if (max == null || typical == null || typical <= 0) return null;
  if (balanceSats < max) return 0;
  return Math.floor((balanceSats - max) / typical) + 1;
}

/**
 * One-shot diagnostic snapshot of "is this model affordable right now?".
 * The gate tracks Routstr's `max_cost` reservation requirement (so the UI
 * never marks a tier affordable that the API will 402), and we report the
 * realistic per-turn estimate alongside it so logs make the spread between
 * "what you'll pay" and "what Routstr reserves" obvious. Keep serialisable;
 * logged verbatim by `ModelChip` and `useAiSend`.
 */
export function getAffordabilityDetails(
  modelId: string,
  balanceSats: number,
  models: RoutstrModel[]
): {
  modelId: string;
  costKnown: boolean;
  estimatedTurnCostSats: number | null;
  bufferedThresholdSats: number | null;
  maxCostSats: number | null;
  balanceSats: number;
  affordable: boolean;
  deficitSats: number;
  catalogSize: number;
} {
  const estimated = estimateTurnCostSats(modelId, models);
  const max = maxCostSats(modelId, models);
  if (max == null) {
    return {
      modelId,
      costKnown: false,
      estimatedTurnCostSats: estimated,
      bufferedThresholdSats: null,
      maxCostSats: null,
      balanceSats,
      affordable: true,
      deficitSats: 0,
      catalogSize: models.length,
    };
  }
  const threshold = Math.ceil(max * AFFORD_BUFFER);
  const affordable = balanceSats >= threshold;
  return {
    modelId,
    costKnown: true,
    estimatedTurnCostSats: estimated,
    bufferedThresholdSats: threshold,
    maxCostSats: max,
    balanceSats,
    affordable,
    deficitSats: affordable ? 0 : Math.max(1, threshold - balanceSats),
    catalogSize: models.length,
  };
}

export function getProviderById(id: AiProviderId | string | null | undefined): AiProvider {
  if (id && PROVIDER_BY_ID.has(id as AiProviderId)) {
    return PROVIDER_BY_ID.get(id as AiProviderId)!;
  }
  return PROVIDER_BY_ID.get(DEFAULT_PROVIDER_ID)!;
}

export function getTierById(id: AiTierId | string | null | undefined): AiTier {
  if (id && TIER_BY_ID.has(id as AiTierId)) return TIER_BY_ID.get(id as AiTierId)!;
  return TIER_BY_ID.get(DEFAULT_TIER_ID)!;
}

/** The lineup entry a (provider, tier) pair points at, or `null` when the
 *  cell is unfilled (partial provider, or no lineup at all yet). */
export function entryForSlot(
  lineup: AiLineup | null,
  provider: AiProviderId,
  tier: AiTierId
): LineupEntry | null {
  return lineup?.[provider]?.[tier] ?? null;
}

/**
 * Ordered candidate entries to try at send time for a (provider, tier)
 * pair. The user's selected cell goes first; the same tier from the other
 * providers follows in `AI_PROVIDER_IDS` order (transparent fallback when
 * the primary's round-trip fails with 5xx/network); then, only if the
 * whole tier row is empty, the selected provider's other tiers and finally
 * everything else — so the send path always has *something* to attempt as
 * long as one lineup cell anywhere is filled. Unfilled cells drop out;
 * duplicates (impossible within a provider, defensive across the merge
 * path) dedup by model id.
 *
 * Ordering rationale: the user picked their provider explicitly, so
 * honour it. Falling back across providers in the same tier is way better
 * than hard-failing — the user just wants a working chat.
 */
export function resolveCandidateEntries(
  provider: AiProviderId,
  tier: AiTierId,
  lineup: AiLineup | null
): LineupEntry[] {
  if (!lineup) return [];
  const tierOrder: AiTierId[] = [tier, ...AI_TIER_IDS.filter((t) => t !== tier)];
  const providerOrder: AiProviderId[] = [
    provider,
    ...AI_PROVIDER_IDS.filter((p) => p !== provider),
  ];
  const seen = new Set<string>();
  const out: LineupEntry[] = [];
  for (const t of tierOrder) {
    for (const p of providerOrder) {
      const entry = lineup[p]?.[t];
      if (!entry || seen.has(entry.modelId)) continue;
      seen.add(entry.modelId);
      out.push(entry);
    }
  }
  return out;
}

/**
 * Resolve a (provider, tier) pair to the lineup entry we'd actually send
 * to right now: the first affordable candidate, else the first candidate
 * at any cost, else `null` — which only happens on a true first-run-offline
 * (no live catalog AND no persisted lineup). Callers must handle `null` by
 * rendering a "models loading" state instead of sending to a guessed id;
 * the old TIER_MATRIX guarantee of "always a defined string" is deliberately
 * relaxed here because a guessed hardcoded id is exactly the rot this
 * change removes.
 */
export function resolveSelectedEntry(
  provider: AiProviderId,
  tier: AiTierId,
  balanceSats: number,
  lineup: AiLineup | null
): LineupEntry | null {
  const chain = resolveCandidateEntries(provider, tier, lineup);
  if (chain.length === 0) return null;
  for (const entry of chain) {
    if (canAffordPricing(entry.satsPricing, balanceSats)) return entry;
  }
  return chain[0];
}

/** Worst-case cost in whole sats for a given model id, or null if unknown.
 *  Read straight from the catalog's `sats_pricing.max_cost`. Reserved for
 *  *diagnostic* / debug log paths — affordability decisions should use
 *  `estimateTurnCostSats` instead, which reflects realistic per-turn
 *  spend. See the comment on `estimateTurnCostSatsFromPricing`. */
function maxCostSats(modelId: string, models: RoutstrModel[]): number | null {
  const m = models.find((mm) => mm.id === modelId);
  const cost = m?.sats_pricing?.max_cost;
  return typeof cost === 'number' ? cost : null;
}

/**
 * True if `balanceSats` covers Routstr's reservation requirement. Routstr
 * 402s any request where balance < `max_cost`, so this gate has to track
 * `max_cost` exactly — gating on the per-turn estimate (which is what the
 * user will actually be charged after refunds) lets the UI mark tiers as
 * affordable that the API will reject upfront.
 *
 * Falls back to `true` when cost data is unavailable (cache not populated)
 * so the picker isn't entirely blank on first paint.
 */
export function canAffordPricing(pricing: LineupPricing | null, balanceSats: number): boolean {
  const cost = pricing?.max_cost ?? null;
  if (cost == null) return true;
  return balanceSats >= cost * AFFORD_BUFFER;
}

/**
 * Whole-sat shortfall to unlock this pricing's tier — the mirror of
 * `canAffordPricing`. Mirrors Routstr's reservation requirement
 * (`max_cost`) so the "Top up X sats" copy reflects what the API will
 * actually accept. Returns `null` when cost data is unknown or already
 * covered. Clamps the result to ≥ 1 sat so we never render "Top up 0 more
 * sats" after rounding.
 */
export function topUpDeficitSatsFromPricing(
  pricing: LineupPricing | null,
  balanceSats: number
): number | null {
  const cost = pricing?.max_cost ?? null;
  if (cost == null) return null;
  const required = Math.ceil(cost * AFFORD_BUFFER);
  if (balanceSats >= required) return null;
  return Math.max(1, required - balanceSats);
}

/**
 * Display-friendly model name pulled directly from the Routstr catalog's
 * `name` field, with the provider prefix stripped. Used wherever we want
 * the user to see the actual model behind a tier label — e.g. the chip
 * subtitle, or each tier row's description. Lineup entries carry the same
 * value precomputed (`displayName`) for offline rendering; this catalog
 * variant remains for send-path surfaces keyed by raw model id (402 popup,
 * fallback logs).
 *
 * Examples:
 *   `claude-haiku-4.5` → "Claude Haiku 4.5"     (from `name: "Anthropic: Claude Haiku 4.5"`)
 *   `gpt-4o-mini`      → "GPT-4o mini"          (from `name: "OpenAI: GPT-4o mini"`)
 *   unknown id         → the id itself
 */
export function getModelDisplayName(modelId: string, models: RoutstrModel[]): string {
  const model = models.find((m) => m.id === modelId);
  if (!model) return modelId;
  const raw = model.name?.trim();
  if (!raw) return modelId;
  const colonIdx = raw.indexOf(':');
  if (colonIdx >= 0 && colonIdx < raw.length - 1) return raw.slice(colonIdx + 1).trim();
  return raw;
}
