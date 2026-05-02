import type { RoutstrModel } from '@/shared/lib/routstr/api';

/**
 * Model picker shown in the AI tab. The picker is a 3 × 3 matrix:
 * three providers (OpenAI, Claude, Grok) crossed with three quality tiers
 * (Auto, Pro, Max). The user picks a (provider, tier) pair via the menu —
 * tabs at the top of the sheet are providers, rows under each tab are
 * tiers — and the runtime resolves that pair to a single model id via
 * `TIER_MATRIX`.
 *
 * Tier intent (cheapest → premium):
 *   - Auto — daily-driver chat, kept under ~100 sats / msg.
 *   - Pro  — frontier reasoning at low latency.
 *   - Max  — most capable, for code and deep reasoning.
 *
 * Edit `TIER_MATRIX` to retune the lineup without a persisted migration —
 * the persisted state is just a (provider id, tier id) pair, never a
 * model id, so swapping `gpt-5.4-mini` for `gpt-5.4-mini-vNext` is
 * invisible to the user. Pricing is NEVER hardcoded — every sat figure
 * rendered to the user is read from `RoutstrModel.sats_pricing` at
 * display time.
 */

export type AiProviderId = 'openai' | 'claude' | 'grok';
export type AiTierId = 'auto' | 'pro' | 'max';

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

export const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI', icon: 'ri:openai-fill' },
  { id: 'claude', label: 'Claude', icon: 'ri:anthropic-fill' },
  { id: 'grok', label: 'Grok', icon: 'ri:twitter-x-fill' },
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

/**
 * Source-of-truth lineup. Outer key is tier, inner key is provider —
 * `TIER_MATRIX[tier][provider]` is the model id we'd send to. Edit
 * freely; runtime fallback through other providers in the same tier is
 * handled by `buildCandidateChain` so a missing entry in any one cell
 * just removes that fallback hop.
 */
export const TIER_MATRIX: Readonly<Record<AiTierId, Readonly<Record<AiProviderId, string>>>> = {
  auto: {
    openai: 'gpt-5-nano',
    claude: 'claude-3.5-haiku',
    grok: 'grok-3-mini',
  },
  pro: {
    openai: 'gpt-5.4-mini',
    claude: 'claude-haiku-4.5',
    grok: 'grok-4.1-fast',
  },
  max: {
    openai: 'gpt-5.4',
    claude: 'claude-sonnet-4.6',
    grok: 'grok-4',
  },
} as const;

export const DEFAULT_PROVIDER_ID: AiProviderId = 'openai';

/** Default tier on app start — also the fallback when a stale (provider,
 *  tier) pair somehow names an id we don't recognise. */
export const DEFAULT_TIER_ID: AiTierId = 'auto';

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

/**
 * Approximate count of additional turns the user could send against
 * `modelId` before Routstr's `max_cost` reservation gate starts rejecting.
 * Two limits are at play:
 *
 *   1. Each turn drops the balance by `estimateTurnCostSats` (the actual
 *      per-turn spend after the reservation refund).
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
export function estimateMessagesRemaining(
  balanceSats: number,
  modelId: string,
  models: RoutstrModel[]
): number | null {
  const max = maxCostSats(modelId, models);
  const typical = estimateTurnCostSats(modelId, models);
  if (max == null || typical == null || typical <= 0) return null;
  if (balanceSats < max) return 0;
  return Math.floor((balanceSats - max) / typical) + 1;
}

/**
 * Estimate a realistic worst-case cost for ONE chat turn against `modelId`,
 * in whole sats. Uses the per-token pricing the Routstr `/models` endpoint
 * publishes — `request` (per-call fee) + `prompt` × `TYPICAL_PROMPT_TOKENS`
 * + `completion` × `TYPICAL_COMPLETION_TOKENS`.
 *
 * Why not `max_cost`? `max_cost` is "fill the entire context window with
 * the most expensive token mix". For a 400k-token gpt-5-nano context that
 * works out to ~84 sats; in practice a turn costs ~0.2 sats. Gating the
 * affordability indicator on `max_cost` was producing "Top up X sats"
 * banners on tiers the user could fund 100+ messages against.
 *
 * Falls back to `max_cost / 100` (a ~hundredth of the worst case is a
 * reasonable typical-turn ballpark) when per-token pricing is missing,
 * and to `null` when the model is unknown to the catalog so the caller
 * can short-circuit to "always affordable until proven otherwise".
 */
export function estimateTurnCostSats(modelId: string, models: RoutstrModel[]): number | null {
  const model = models.find((m) => m.id === modelId);
  if (!model) return null;
  const pricing = model.sats_pricing;
  if (!pricing) return null;
  const promptPer = typeof pricing.prompt === 'number' ? pricing.prompt : null;
  const completionPer = typeof pricing.completion === 'number' ? pricing.completion : null;
  const request = typeof pricing.request === 'number' ? pricing.request : 0;
  if (promptPer != null && completionPer != null) {
    const cost =
      request + promptPer * TYPICAL_PROMPT_TOKENS + completionPer * TYPICAL_COMPLETION_TOKENS;
    return cost;
  }
  if (typeof pricing.max_cost === 'number') {
    return pricing.max_cost / 100;
  }
  return null;
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

/** Look up the model id for a (provider, tier) pair. Always returns a
 *  defined string because `TIER_MATRIX` is exhaustive. */
export function modelIdForSlot(provider: AiProviderId, tier: AiTierId): string {
  return TIER_MATRIX[tier][provider];
}

/**
 * Ordered list of model ids to try at send time for a (provider, tier)
 * pair. The user's selected provider goes first; the same tier from the
 * other providers follows in `AI_PROVIDERS` order, providing transparent
 * fallback when the primary's network round-trip fails (5xx / network).
 *
 * Ordering rationale: the user picked their preferred provider explicitly,
 * so honour it. Falling back across providers (Claude → Grok → OpenAI in
 * the same Auto tier) is way better than hard-failing — the user just
 * wants a working chat.
 */
export function buildCandidateChain(provider: AiProviderId, tier: AiTierId): string[] {
  const primary = modelIdForSlot(provider, tier);
  const fallbacks = AI_PROVIDERS.filter((p) => p.id !== provider).map((p) =>
    modelIdForSlot(p.id, tier)
  );
  return [primary, ...fallbacks];
}

/**
 * Resolve a (provider, tier) pair to the first model id we'd actually
 * send to right now. Walks the candidate chain returned by
 * `buildCandidateChain`, preferring entries that are present in the live
 * catalog AND affordable. Falls back to "in-catalog at any cost" and
 * finally to "first listed" so the chip and send path always have a
 * model id, even before the catalog finishes loading.
 */
export function resolveSelectedModel(
  provider: AiProviderId,
  tier: AiTierId,
  balanceSats: number,
  models: RoutstrModel[]
): string {
  const chain = buildCandidateChain(provider, tier);
  if (models.length === 0) return chain[0];
  for (const c of chain) {
    if (!models.some((m) => m.id === c)) continue;
    if (canAffordModel(c, balanceSats, models)) return c;
  }
  for (const c of chain) {
    if (models.some((m) => m.id === c)) return c;
  }
  return chain[0];
}

/**
 * In-catalog candidate chain for runtime fallback at send time. Same
 * shape as `buildCandidateChain` but filtered to ids actually present in
 * the catalog (so we don't try a retired model and waste a round-trip).
 * Falls through to the unfiltered list when the catalog is empty so a
 * cold start still has something to attempt.
 */
export function resolveCandidateChainForSlot(
  provider: AiProviderId,
  tier: AiTierId,
  models: RoutstrModel[]
): string[] {
  const chain = buildCandidateChain(provider, tier);
  if (models.length === 0) return chain;
  const inCatalog = chain.filter((id) => models.some((m) => m.id === id));
  return inCatalog.length > 0 ? inCatalog : chain;
}

/** Worst-case cost in whole sats for a given model id, or null if unknown.
 *  Read straight from the catalog's `sats_pricing.max_cost`. Reserved for
 *  *diagnostic* / debug log paths — affordability decisions should use
 *  `estimateTurnCostSats` instead, which reflects realistic per-turn
 *  spend. See the comment on `estimateTurnCostSats` for the rationale. */
export function maxCostSats(modelId: string, models: RoutstrModel[]): number | null {
  const m = models.find((mm) => mm.id === modelId);
  const cost = m?.sats_pricing?.max_cost;
  return typeof cost === 'number' ? cost : null;
}

/**
 * True if `balanceSats` covers Routstr's reservation requirement for
 * `modelId`. Routstr 402s any request where balance < `max_cost`, so this
 * gate has to track `max_cost` exactly — gating on the per-turn estimate
 * (which is what the user will actually be charged after refunds) lets the
 * UI mark tiers as affordable that the API will reject upfront.
 *
 * Falls back to `true` when cost data is unavailable (cache not populated)
 * so the picker isn't entirely blank on first paint.
 */
export function canAffordModel(
  modelId: string,
  balanceSats: number,
  models: RoutstrModel[]
): boolean {
  const cost = maxCostSats(modelId, models);
  if (cost == null) return true;
  return balanceSats >= cost * AFFORD_BUFFER;
}

/**
 * Whole-sat shortfall to unlock `modelId`'s tier — the mirror of
 * `canAffordModel`. Mirrors Routstr's reservation requirement (`max_cost`)
 * so the "Top up X sats" copy reflects what the API will actually accept.
 * Returns `null` when cost data is unknown or already covered. Clamps the
 * result to ≥ 1 sat so we never render "Top up 0 more sats" after rounding.
 */
export function topUpDeficitSats(
  modelId: string,
  balanceSats: number,
  models: RoutstrModel[]
): number | null {
  const cost = maxCostSats(modelId, models);
  if (cost == null) return null;
  const required = Math.ceil(cost * AFFORD_BUFFER);
  if (balanceSats >= required) return null;
  return Math.max(1, required - balanceSats);
}

/**
 * Display-friendly model name pulled directly from the Routstr catalog's
 * `name` field, with the provider prefix stripped. Used wherever we want
 * the user to see the actual model behind a tier label — e.g. the chip
 * subtitle, or each tier row's description.
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

/** Relative timestamp suitable for the conversations list. */
export function formatRelative(timestampMs: number): string {
  const date = new Date(timestampMs);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
