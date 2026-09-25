import { ROUTSTR_MAX_COMPLETION_TOKENS, type RoutstrModel } from '@/shared/lib/routstr/api';
import {
  AI_PROVIDER_IDS,
  AI_TIER_IDS,
  E2EE_PROVIDER_ID,
  isE2eeModelId,
  lineupHasEntries,
  lineupProviderIds,
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
 * derivation: the AI tab's (provider id, tier id) selection is
 * session-only state, so a lineup change never needs a migration. (The
 * persisted `selectedModel` id belongs to the legacy UserMessagesScreen
 * surface, not this picker.) Pricing is NEVER hardcoded — every sat figure
 * rendered to the user is read from the catalog's `sats_pricing` (or the
 * persisted lineup snapshot's compact copy of it) at display time.
 *
 * Tier intent under the price ordering (see `deriveLineup` /
 * nagg's `buildAILineup` — both assign tiers the same way):
 *   - Auto — the provider's cheapest qualifying model.
 *   - Pro  — the median of the price ladder.
 *   - Max  — the flagship: newest model in the top price quartile.
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

/**
 * Display metadata for the vendors the app ships a logo for.
 *
 * No longer the whole menu. The lineup's vendors come from the catalog, so
 * anything outside this table gets a title-cased label and the generic glyph
 * — a vendor without a brand icon is still a vendor the user can pick.
 */
const AI_PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI', icon: 'ri:openai-fill' },
  { id: 'claude', label: 'Claude', icon: 'ri:anthropic-fill' },
  { id: 'grok', label: 'Grok', icon: 'ri:twitter-x-fill' },
  { id: 'google', label: 'Google', icon: 'ri:google-fill' },
] as const;

/**
 * The encrypted vendor's tab.
 *
 * Deliberately not in `AI_PROVIDERS`: that list doubles as the menu's floor
 * when no lineup has landed, and offering an encrypted tab a node may not
 * serve would promise a privacy the app cannot deliver. This entry only ever
 * reaches the user through `getProviderById`, i.e. after the lineup has
 * actually grouped sealed models under it.
 *
 * "Tinfoil" is the enclave operator's name and says nothing to the person
 * choosing it; the label and the padlock say what the tab is FOR, which is the
 * only reason to pick it.
 */
/**
 * The padlock, and what it is when spoken.
 *
 * Encryption is a property of a MODEL, not of the node serving it or of the
 * vendor that trained it: a node's catalog lists `glm-5-3` beside
 * `tinfoil-glm-5-3` under one display name at one price, and only the second
 * is sealed. So every surface that draws this lock has to decide per row with
 * `isE2eeModelId`, and a lock on a provider would put it on the plaintext twin
 * in the next row.
 *
 * The glyph alone says "locked" to a screen reader — which is equally what a
 * disabled row and a passcode field look like — so the badge carries a
 * sentence saying which of those it means. Both live here so the picker row,
 * the chip and the encrypted vendor's own tab cannot drift apart.
 */
export const E2EE_BADGE_ICON = 'mdi:lock-outline';
export const E2EE_BADGE_LABEL = 'End-to-end encrypted';

const E2EE_PROVIDER: AiProvider = {
  id: E2EE_PROVIDER_ID,
  label: 'Private (E2EE)',
  icon: E2EE_BADGE_ICON,
};

/** Catalog slugs are lowercase and hyphenated (`mistralai`, `bytedance-seed`,
 *  `z-ai`); this is the smallest rule that turns one into something readable
 *  without a table nobody will maintain. */
function labelForVendor(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The vendors a lineup offers, with display metadata, in the lineup's own
 *  order. This — not `AI_PROVIDERS` — is what a picker should iterate. */
export function providersForLineup(lineup: AiLineup | null | undefined): AiProvider[] {
  const ids = lineupProviderIds(lineup);
  if (ids.length === 0) return [...AI_PROVIDERS];
  return ids.map((id) => getProviderById(id));
}

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

/** Stand-in glyph for a vendor the app ships no logo for. */
const GENERIC_PROVIDER_ICON = 'fluent:apps-16-filled';

const PROVIDER_BY_ID = new Map<AiProviderId, AiProvider>(
  [...AI_PROVIDERS, E2EE_PROVIDER].map((p) => [p.id, p] as const)
);
const TIER_BY_ID = new Map<AiTierId, AiTier>(AI_TIERS.map((t) => [t.id, t] as const));

/**
 * Safety multiplier on the reservation estimate the affordability gate
 * mirrors. The server estimates prompt tokens as `chars / 3` while we gate
 * on a fixed typical-turn size, so a small cushion absorbs estimator skew
 * without re-introducing the old full-`max_cost` false negatives.
 */
export const AFFORD_BUFFER = 1.1;

/**
 * The `max_tokens` one request to this model actually carries — and therefore
 * the completion budget the node's admission gate charges for it.
 *
 * There is exactly one number here and it has to be spelled once. The send
 * path clamps `ROUTSTR_MAX_COMPLETION_TOKENS` under the model's own ceiling
 * (`top_provider.max_completion_tokens`, carried into the lineup as
 * `maxCompletionTokens`) so the request cannot ask a model for more than it
 * will produce; routstr-core's `calculate_discounted_max_cost` then prices the
 * completion side at exactly that figure. If the gate below kept using the
 * flat 4096 while the wire sent 1024, the two would disagree by 4× on every
 * short-ceiling model — always in the direction of demanding funds the node
 * was never going to reserve.
 *
 * `temperature` gets no equivalent because the catalogue carries no equivalent
 * field: `RoutstrModel` has `top_provider.max_completion_tokens` and nothing
 * that says which models accept a sampling temperature. A parameter we cannot
 * defend per model from catalogue data is one we do not send (see
 * `useAiSend`).
 */
export function sendMaxTokens(maxCompletionTokens: number | null | undefined): number {
  return maxCompletionTokens != null && maxCompletionTokens > 0
    ? Math.min(ROUTSTR_MAX_COMPLETION_TOKENS, maxCompletionTokens)
    : ROUTSTR_MAX_COMPLETION_TOKENS;
}

/**
 * The typical-case reservation, for callers that cannot see the real request.
 *
 * NOT what the spend sheet quotes any more. The node sizes its admission gate
 * from the actual body — `features/ai/lib/reserve.ts` mirrors that arithmetic
 * and is what the user now approves. This function prices a hypothetical
 * average turn (`TYPICAL_PROMPT_TOKENS` of prompt) and was being shown as
 * though it were the real figure: a device log has it quoting 10 sats while
 * 307 left the wallet, because the model was sealed and the node would not
 * discount its completion side at all.
 *
 * What it is still good for is the affordability floor before a message
 * exists — a balance that cannot cover an average turn cannot cover this one
 * either, and saying so early is cheaper than assembling a request to find
 * out. `evaluateSendGate` uses it exactly there, and nowhere else.
 */
export function maxSpendSats(entry: LineupEntry | null, imageCount = 0): number {
  const reserve = requiredReserveSatsFromPricing(
    entry?.satsPricing ?? null,
    imageCount,
    entry?.maxCompletionTokens
  );
  return Math.max(1, Math.ceil((reserve ?? 1) * AFFORD_BUFFER));
}

/**
 * Typical chat-turn input size used to estimate cost from per-token
 * pricing. Chat messages and surrounding context together rarely exceed
 * ~8k prompt tokens; bumping this up just makes the affordability gate
 * artificially tight for short conversations (which are the overwhelming
 * majority of usage).
 */
export const TYPICAL_PROMPT_TOKENS = 8000;

/**
 * Typical chat-turn output size — "the assistant writes a couple of
 * paragraphs".
 *
 * Deliberately the SAME number as `ROUTSTR_MAX_COMPLETION_TOKENS`, not a
 * coincidence and not to be forked back apart. They were different (2000 here,
 * 4096 on the wire) and that disagreement was load-bearing in the wrong
 * direction: every cost figure the user read was derived from a completion
 * budget the request was not asking for. What a turn is expected to write is
 * what we ask the node to reserve for it, and both readings of that sentence
 * resolve to one constant.
 *
 * Retune it against `ai.stream.complete`, which now records `maxTokens`,
 * `finishReason` and `approxCompletionTokens` on every answer — and, when the
 * budget is what ended the stream, says so to the user rather than silently
 * cutting the answer off.
 */
const TYPICAL_COMPLETION_TOKENS = ROUTSTR_MAX_COMPLETION_TOKENS;

/** The catalogue row's own completion ceiling, read the same way
 *  `toLineupEntry` reads it — so a gate keyed by raw model id charges the
 *  same `max_tokens` a gate keyed by lineup entry does. */
function maxCompletionTokensForModel(modelId: string, models: RoutstrModel[]): number | null {
  const raw = models.find((m) => m.id === modelId)?.top_provider?.max_completion_tokens;
  return typeof raw === 'number' && raw > 0 ? Math.floor(raw) : null;
}

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
  return satsFromPricing(pricing, imageCount, TYPICAL_COMPLETION_TOKENS, 1 / 100);
}

/**
 * Shared per-turn cost arithmetic for the estimate/reserve pair above and
 * below — they price the same request shape and differ only in how many
 * completion tokens they budget and how much of `max_cost` the fallback
 * charges (see each wrapper's doc for the why).
 */
function satsFromPricing(
  pricing: LineupPricing | null,
  imageCount: number,
  completionTokens: number,
  maxCostScale: number
): number | null {
  if (!pricing) return null;
  const imageFee = typeof pricing.image === 'number' ? pricing.image * imageCount : 0;
  if (pricing.prompt != null && pricing.completion != null) {
    return (
      (pricing.request ?? 0) +
      pricing.prompt * TYPICAL_PROMPT_TOKENS +
      pricing.completion * completionTokens +
      imageFee
    );
  }
  if (pricing.max_cost != null) {
    return pricing.max_cost * maxCostScale + imageFee;
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
 * The balance Routstr actually requires upfront for one request, in sats —
 * the number the affordability gate and "Top up X sats" copy must track.
 *
 * Routstr admits a request when the balance covers the DISCOUNTED max cost
 * (routstr-core `calculate_discounted_max_cost`): the prompt side shrinks
 * to the actual prompt size automatically, and the completion side shrinks
 * to `max_tokens × completion` because `useAiSend` sends `sendMaxTokens` with
 * every request. So the requirement is
 *
 *   `request + TYPICAL_PROMPT_TOKENS × prompt + max_tokens × completion`
 *
 * — NOT `max_cost`. Gating on `max_cost` (fill-the-whole-context worst
 * case, ~3,600 sats for a frontier model) is what produced "insufficient
 * balance" on balances that funded hundreds of real turns. The reservation
 * is refunded down to actual usage after the stream completes.
 *
 * `maxCompletionTokens` is the model's own ceiling from the catalogue
 * (`LineupEntry.maxCompletionTokens`, i.e. `top_provider.max_completion_tokens`).
 * The send path clamps `max_tokens` under it, so the gate has to price the
 * clamped figure or it demands funds for a completion budget the request never
 * asked for — four times too much on a 1k-ceiling model. Omitting it prices
 * the unclamped default, which is what a caller holding only a pricing record
 * can honestly say.
 *
 * Falls back to `max_cost` when per-token pricing is missing (the server
 * can't discount what it can't price either) and `null` when pricing is
 * unknown entirely.
 */
export function requiredReserveSatsFromPricing(
  pricing: LineupPricing | null,
  imageCount = 0,
  maxCompletionTokens?: number | null
): number | null {
  return satsFromPricing(pricing, imageCount, sendMaxTokens(maxCompletionTokens), 1);
}

/**
 * One-shot diagnostic snapshot of "is this model affordable right now?".
 * The gate tracks Routstr's discounted admission requirement (see
 * `requiredReserveSatsFromPricing` — with `max_tokens` sent, the node
 * requires prompt + max_tokens×completion, NOT `max_cost`). The realistic
 * per-turn estimate and the raw `max_cost` ride along so logs make the
 * spread between "what you'll pay", "what Routstr holds", and the old
 * worst-case ceiling obvious. Keep serialisable; logged verbatim by
 * `ModelChip` and `useAiSend`.
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
  /** The `max_tokens` the request will carry, which is what the node's
   *  admission gate charges the completion side at. Logged so a threshold
   *  that disagrees with the wire is one field rather than an inference. */
  sentMaxTokens: number;
  balanceSats: number;
  affordable: boolean;
  deficitSats: number;
  catalogSize: number;
} {
  const pricing = pricingForModel(modelId, models);
  const estimated = estimateTurnCostSatsFromPricing(pricing);
  // The same clamped `max_tokens` the request will carry — read straight off
  // the catalogue row, so this snapshot and the wire cannot disagree.
  const ceiling = maxCompletionTokensForModel(modelId, models);
  const reserve = requiredReserveSatsFromPricing(pricing, 0, ceiling);
  if (reserve == null) {
    return {
      modelId,
      costKnown: false,
      estimatedTurnCostSats: estimated,
      bufferedThresholdSats: null,
      maxCostSats: maxCostSats(modelId, models),
      sentMaxTokens: sendMaxTokens(ceiling),
      balanceSats,
      affordable: true,
      deficitSats: 0,
      catalogSize: models.length,
    };
  }
  const threshold = Math.ceil(reserve * AFFORD_BUFFER);
  const affordable = balanceSats >= threshold;
  return {
    modelId,
    costKnown: true,
    estimatedTurnCostSats: estimated,
    bufferedThresholdSats: threshold,
    maxCostSats: maxCostSats(modelId, models),
    sentMaxTokens: sendMaxTokens(ceiling),
    balanceSats,
    affordable,
    deficitSats: affordable ? 0 : Math.max(1, threshold - balanceSats),
    catalogSize: models.length,
  };
}

/**
 * Display metadata for a vendor id.
 *
 * An id the app has no logo for is not an error and must not silently become
 * OpenAI — that is how a Qwen selection used to render as somebody else's
 * brand. Unknown ids get a readable label and the generic glyph; only a
 * genuinely absent id falls back to the default.
 */
export function getProviderById(id: AiProviderId | string | null | undefined): AiProvider {
  if (!id) return PROVIDER_BY_ID.get(DEFAULT_PROVIDER_ID)!;
  const known = PROVIDER_BY_ID.get(id);
  if (known) return known;
  return { id, label: labelForVendor(id), icon: GENERIC_PROVIDER_ICON };
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
 * A lineup entry whose model id carries the end-to-end-encryption prefix.
 *
 * The brand is not decoration. `@routstr/sdk` switches its sealed transport on
 * `modelId.startsWith('tinfoil-')` and nothing else, so the id IS the
 * encryption switch — which makes "this entry is encrypted" a fact about a
 * value, not about the variable holding it. Branding it means a plaintext
 * `LineupEntry` is not assignable where a sealed one is required, so a
 * downgrade has to be written as an explicit cast rather than as an ordinary
 * `push`, a `concat` or a widened fallback list.
 *
 * The brand symbol is module-private and `sealEntry` below is its only
 * producer, so every sealed value in the app has been through `isE2eeModelId`.
 */
declare const SEALED_BRAND: unique symbol;
type SealedLineupEntry = LineupEntry & { readonly [SEALED_BRAND]: true };

/**
 * The ordered models one send may attempt, tagged with whether the user's
 * selection promised encryption.
 *
 * Tagged rather than a bare array because the two chains obey different rules
 * and the difference is a privacy promise, not a preference. A plaintext
 * selection wants the widest possible fallback — the user asked for a working
 * chat. A sealed selection wants the narrowest: every attempt must stay inside
 * `E2EE_PROVIDER_ID`, and running out is a failure the user must be told
 * about, because the alternative is answering a prompt they chose to encrypt
 * on a model that reads it in the clear.
 *
 * Making `entries` a `SealedLineupEntry[]` on the sealed branch is what stops
 * that being reintroduced by accident: the generic-vendor fallback the
 * plaintext branch builds simply does not type-check into it.
 */
type CandidateChain =
  | { readonly sealed: true; readonly entries: readonly SealedLineupEntry[] }
  | { readonly sealed: false; readonly entries: readonly LineupEntry[] };

/**
 * The one place a `SealedLineupEntry` comes into existence, and the one cast
 * in this module.
 *
 * `null` for an entry filed under the encrypted vendor whose id lost the
 * prefix — a catalogue that renames a row, or a lineup snapshot persisted
 * before the grouping existed. Dropping it costs that model; trusting the
 * grouping over the id would send a sealed-labelled prompt in the clear.
 */
function sealEntry(entry: LineupEntry): SealedLineupEntry | null {
  return isE2eeModelId(entry.modelId) ? (entry as SealedLineupEntry) : null;
}

/**
 * Ordered candidate entries to try at send time for a (provider, tier)
 * pair. The user's selected cell goes first; the same tier from the other
 * vendors follows in `plaintextFallbackOrder` (transparent fallback when
 * the primary's round-trip fails with 5xx/network); then, only if the
 * whole tier row is empty, the selected provider's other tiers and finally
 * everything else — so the send path always has *something* to attempt as
 * long as one lineup cell anywhere is filled. Unfilled cells drop out;
 * duplicates (impossible within a provider, defensive across the merge
 * path) dedup by model id.
 *
 * "The other vendors" means the ones this LINEUP offers, not the four the app
 * happens to ship a logo for — see `plaintextFallbackOrder` for why that
 * distinction was a dead send button.
 *
 * Ordering rationale: the user picked their provider explicitly, so
 * honour it. Falling back across providers in the same tier is way better
 * than hard-failing — the user just wants a working chat.
 *
 * EXCEPT when the selected vendor is `E2EE_PROVIDER_ID`. That fallback used
 * to apply there too, so a sealed pick that was merely unaffordable — or a
 * node that answered 402 for it once — was answered by an OpenAI model with
 * no signal that anything had changed. The badge said end-to-end encrypted
 * and the bytes went out in the clear. A sealed selection therefore walks
 * only the encrypted vendor's own tier ladder, and an empty result is the
 * honest answer rather than the start of a search elsewhere.
 *
 * This is the chain's ONLY constructor, which is why the rule lives here and
 * not at the send site: a future caller cannot widen a sealed chain without
 * coming through `sealEntry`.
 */
export function resolveCandidateEntries(
  provider: AiProviderId,
  tier: AiTierId,
  lineup: AiLineup | null
): CandidateChain {
  const tierOrder: AiTierId[] = [tier, ...AI_TIER_IDS.filter((t) => t !== tier)];
  if (provider === E2EE_PROVIDER_ID) {
    return { sealed: true, entries: sealedEntries(tierOrder, lineup) };
  }
  if (!lineup) return { sealed: false, entries: [] };
  const providerOrder = plaintextFallbackOrder(provider, lineup);
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
  return { sealed: false, entries: out };
}

/**
 * The vendors a plaintext chain may walk, in the order it walks them: the
 * user's pick, then the four `AI_PROVIDER_IDS` names, then every other vendor
 * this lineup actually offers.
 *
 * The tail is the repair. `AI_PROVIDER_IDS` is the known-and-NAMED subset —
 * its own doc says so — while a lineup's vendors come from the node's
 * catalogue, and `deriveLineup` has offered up to twelve of them since the
 * hardcoded four were retired. Walking the four alone meant a node serving
 * `qwen`, `deepseek` and `z-ai` and nothing else produced a chain of zero from
 * a lineup that was full, and the send refused with "the model list has not
 * loaded" while holding the catalogue it had just derived that lineup from.
 * The picker was already fixed to iterate the lineup's own vendors
 * (`providersForLineup`); the send path was not, and that divergence is the
 * bug.
 *
 * The named four still lead, so an ordinary catalogue walks exactly the order
 * it always did — this only ever appends.
 *
 * `E2EE_PROVIDER_ID` is deliberately NOT here. A plaintext chain that could
 * reach a sealed model would spend enclave prices without being asked, and the
 * encrypted vendor is reached by selecting it (`routstrStore` re-points a
 * selection the lineup cannot answer, including onto this vendor when it is
 * the only one a node serves) — never by drifting into it mid-fallback.
 */
function plaintextFallbackOrder(provider: AiProviderId, lineup: AiLineup): AiProviderId[] {
  const order: AiProviderId[] = [provider];
  const seen = new Set<AiProviderId>(order);
  const push = (id: AiProviderId) => {
    if (seen.has(id) || id === E2EE_PROVIDER_ID) return;
    seen.add(id);
    order.push(id);
  };
  for (const id of AI_PROVIDER_IDS) push(id);
  for (const id of lineupProviderIds(lineup)) push(id);
  return order;
}

/** The encrypted vendor's own tier ladder, sealed-checked id by id. No other
 *  vendor is reachable from here — that is the whole point of the branch. */
function sealedEntries(
  tierOrder: readonly AiTierId[],
  lineup: AiLineup | null
): SealedLineupEntry[] {
  const vendor = lineup?.[E2EE_PROVIDER_ID];
  if (!vendor) return [];
  const seen = new Set<string>();
  const out: SealedLineupEntry[] = [];
  for (const t of tierOrder) {
    const entry = vendor[t];
    if (!entry || seen.has(entry.modelId)) continue;
    const sealed = sealEntry(entry);
    if (!sealed) continue;
    seen.add(entry.modelId);
    out.push(sealed);
  }
  return out;
}

/**
 * The entry a chain would actually be sent to right now: the first affordable
 * candidate, else the first candidate at any cost, else `null`.
 *
 * Note what "else the first candidate at any cost" means on each branch. On a
 * plaintext chain it is a cheaper vendor's model, which is the fallback the
 * user wants. On a sealed chain every member is encrypted, so the worst case
 * is an encrypted model the wallet cannot yet fund — which the send gate
 * turns into "top up", not into a silent plaintext send. The affordability
 * search can no longer be the thing that breaks the promise.
 */
export function selectFromChain(chain: CandidateChain, balanceSats: number): LineupEntry | null {
  const { entries } = chain;
  if (entries.length === 0) return null;
  for (const entry of entries) {
    // Priced at the `max_tokens` this entry's request will actually carry —
    // the chain must not skip a model the node would have admitted.
    if (canAffordPricing(entry.satsPricing, balanceSats, entry.maxCompletionTokens)) return entry;
  }
  return entries[0];
}

/**
 * Resolve a (provider, tier) pair to the lineup entry we'd actually send
 * to right now: the first affordable candidate, else the first candidate
 * at any cost, else `null` — which only happens on a true first-run-offline
 * (no live catalog AND no persisted lineup), or on an encrypted selection a
 * node serves no sealed model for. Callers must handle `null` by rendering a
 * "models loading" state instead of sending to a guessed id; the old
 * TIER_MATRIX guarantee of "always a defined string" is deliberately relaxed
 * here because a guessed hardcoded id is exactly the rot this change removes.
 */
export function resolveSelectedEntry(
  provider: AiProviderId,
  tier: AiTierId,
  balanceSats: number,
  lineup: AiLineup | null
): LineupEntry | null {
  return selectFromChain(resolveCandidateEntries(provider, tier, lineup), balanceSats);
}

/**
 * What the chip says instead of a model name when the node has answered and
 * the selection still resolves to nothing.
 *
 * `resolveSelectedEntry` returns `null` for two different reasons and only one
 * of them is "not loaded yet": against a lineup that HAS entries, `null` means
 * this node serves nothing the selection can reach. In practice that is the
 * sealed selection on a node with no `tinfoil-` row — the one case the store
 * deliberately refuses to repair by moving the user, because moving them is
 * the silent downgrade. The chip previously fell back to repeating the tier
 * label, so that state rendered as "Auto · Auto": a selection that reads like
 * it works, on the one surface whose entire job is naming what a turn will be
 * sent to. The first sign of trouble was a failed send.
 *
 * It names the vendor rather than the tier because the vendor is what has to
 * change, and it names no model at all — a chip showing a model this node
 * cannot supply is its own bug, whether the model is a sealed one that is not
 * here or a plaintext one the user never chose.
 */
export const UNSERVED_SELECTION_LABEL = 'Not on this node';

/**
 * Whether the node currently in front of the app can answer this selection.
 *
 * `false` only when a lineup with entries — a node that has answered —
 * resolves the pair to nothing. An absent or empty lineup is "no answer yet",
 * which is a different state with different copy.
 */
export function isSelectionServed(
  provider: AiProviderId,
  tier: AiTierId,
  balanceSats: number,
  lineup: AiLineup | null
): boolean {
  if (!lineupHasEntries(lineup)) return true;
  return resolveSelectedEntry(provider, tier, balanceSats, lineup) != null;
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
 * True if `balanceSats` covers Routstr's admission requirement — the
 * discounted reservation (`requiredReserveSatsFromPricing`), not the raw
 * `max_cost` ceiling. See that function for the server-side contract.
 *
 * Falls back to `true` when cost data is unavailable (cache not populated)
 * so the picker isn't entirely blank on first paint.
 */
export function canAffordPricing(
  pricing: LineupPricing | null,
  balanceSats: number,
  maxCompletionTokens?: number | null
): boolean {
  const reserve = requiredReserveSatsFromPricing(pricing, 0, maxCompletionTokens);
  if (reserve == null) return true;
  return balanceSats >= reserve * AFFORD_BUFFER;
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
