/**
 * What the node will actually hold for THIS request, in sats.
 *
 * Not an estimate of a typical turn — the arithmetic `@routstr/sdk` runs, on
 * the body we are about to send, producing the number it will mint. The app
 * used to quote a different calculation entirely: a typical-case reserve built
 * from `TYPICAL_PROMPT_TOKENS` and a flat `AFFORD_BUFFER`. It was wrong in the
 * direction that matters. A device log has the sheet offering "up to 10 sats"
 * while 307 left the wallet for a 1-sat answer, and 896 for an answer that
 * never arrived. A figure the user approves has to be the figure that goes.
 *
 * ## The formula, and why it is duplicated here
 *
 * The SDK does not export its pricing. `ProviderManager.getRequiredSatsForModel`
 * is called from inside `routeRequest`, after we have committed to the send, and
 * the number never comes back out. So the only way to say it before the sheet is
 * to compute it — which makes this module a mirror, with the obligation that
 * comes with one: it is written to match `@routstr/sdk@<installed>`'s
 * `getRequiredSatsForModel` / `nodeGateSats` line for line, and
 * `__tests__/aiReserve.test.ts` pins it against three reservations observed on
 * a real device (307, 896 and 1 sat) so a drift in either direction fails
 * rather than silently under-quoting again.
 *
 *   requiredSats = min(max_cost, max(componentEstimate, nodeGateEstimate))
 *
 * with both estimates carrying the SDK's own 5% margin, and the whole thing
 * rounded up when the token is minted.
 *
 * ## Two things this made visible
 *
 * 1. `max_tokens` does NOT shrink a `tinfoil-*` reservation. Both completion
 *    discounts — the component estimate's and the node gate's — are explicitly
 *    skipped for Tinfoil models, because the node cannot read a sealed body to
 *    check the bound. And every Tinfoil catalogue row prices
 *    `max_completion_cost === max_cost`, so the component estimate alone
 *    exceeds `max_cost` and the cap returns it. An encrypted request reserves
 *    the model's entire ceiling, always, whatever we ask for. That is the
 *    307-sat case, and no `max_tokens` we could have picked would have moved it.
 *    It is the price of the enclave, and the sheet now says so out loud.
 * 2. The reservation is dominated by the completion side on every other model,
 *    where `max_tokens` is linear in it — which is why that constant is now the
 *    one the cost column already used (`ROUTSTR_MAX_COMPLETION_TOKENS`).
 */
import {
  routstrChatRequestBody,
  type RoutstrChatMessage,
  type RoutstrModel,
} from '@/shared/lib/routstr/api';
import type { LineupEntry } from '@/shared/lib/routstr/lineup';

/**
 * The pricing fields the reservation needs. A superset of `LineupPricing`:
 * `max_completion_cost` is the one field the compact lineup copy drops, and
 * the SDK's very first branch keys on it, so a caller that can reach a live
 * `/v1/models` row should pass that row's `sats_pricing` rather than the
 * lineup's.
 */
export interface ReservePricing {
  prompt: number | null;
  completion: number | null;
  request: number | null;
  max_cost: number | null;
  /**
   * The node's ceiling on one answer, in sats. Absent from a persisted lineup
   * entry, where it is reconstructed as `completion × maxCompletionTokens` —
   * an identity that holds exactly on every catalogue row observed (the node
   * derives it the same way).
   */
  max_completion_cost: number | null;
}

interface ReserveInput {
  /** Catalogue id, because `tinfoil-` changes the arithmetic. */
  modelId: string;
  pricing: ReservePricing | null;
  /** `top_provider.context_length`, falling back to the row's own. */
  contextLength: number | null;
  /** `top_provider.max_completion_tokens`. */
  maxCompletionTokens: number | null;
  /** The messages exactly as they will go on the wire. */
  messages: readonly RoutstrChatMessage[];
  /** The `max_tokens` the request will carry (`sendMaxTokens`). */
  maxTokens: number;
}

/** The SDK's prompt-token estimator: `ceil(chars / 2.84)`. */
const SDK_CHARS_PER_TOKEN = 2.84;
/** The SDK's headroom on both of its estimates. */
const SDK_MARGIN = 1.05;
/** `NODE_TOLERANCE_PERCENT = 1` in the SDK's node-gate mirror. */
const NODE_TOLERANCE = 0.99;
/** The node's own cruder estimator, over the serialised body. */
const NODE_CHARS_PER_TOKEN = 3;
/**
 * `85 + 170 × 4`, the SDK's ceiling for an `auto`-detail image — and a true
 * ceiling, not a guess: `calculateImageTokens` clamps both sides to 768px
 * before tiling at 512px, so four tiles is the most any image can produce.
 * We send no `detail`, so `auto` is the only case that can arise.
 */
const MAX_AUTO_IMAGE_TOKENS = 85 + 170 * 4;
/** What the SDK charges when it cannot see a prompt shape at all. */
const UNKNOWN_PROMPT_TOKENS = 10_000;
/** The SDK's last-resort reservation when a row carries no pricing. */
const NO_PRICING_FALLBACK_SATS = 50;

/**
 * Encrypted models are priced without the discount.
 *
 * The node forwards a sealed body it cannot read, so it cannot verify a
 * `max_tokens` bound and refuses to credit one. Mirrors the SDK's
 * `isTinfoilModel`.
 */
export function isSealedModelId(modelId: string): boolean {
  return modelId.startsWith('tinfoil-');
}

/** Text chars the SDK counts: `text` parts and bare string content only —
 *  never the base64 of an image, which is counted as tokens instead. */
function messageTextChars(messages: readonly RoutstrChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    const content = message.content;
    if (typeof content === 'string') {
      total += content.length;
      continue;
    }
    for (const part of content) {
      if (part.type === 'text') total += part.text.length;
    }
  }
  return total;
}

/** Image tokens at the SDK's `auto` ceiling. The SDK reads the real
 *  resolution out of the data-URL when it can and charges less; quoting the
 *  ceiling can only over-state, which is the safe direction for a number the
 *  user is about to approve. */
function messageImageTokens(messages: readonly RoutstrChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type === 'image_url') total += MAX_AUTO_IMAGE_TOKENS;
    }
  }
  return total;
}

/**
 * Every string in the body, keys included — the node's own accounting, which
 * the SDK reproduces in `estimateNodePromptTokens`. Deliberately crude and
 * deliberately faithful: the base64 of an attachment lands in here in full.
 */
function sumStringChars(node: unknown): number {
  if (typeof node === 'string') return node.length;
  if (Array.isArray(node)) return node.reduce<number>((sum, item) => sum + sumStringChars(item), 0);
  if (node !== null && typeof node === 'object') {
    let total = 0;
    for (const [key, value] of Object.entries(node)) total += key.length + sumStringChars(value);
    return total;
  }
  return 0;
}

/**
 * The node's admission gate, as the SDK models it: start from the model's
 * whole-context worst case and hand back the budget this request provably
 * cannot use — the unclaimed prompt window, and (unless the body is sealed)
 * the completion tokens beyond `max_tokens`.
 */
function nodeGateSats(input: ReserveInput, pricing: ReservePricing, imageTokens: number): number {
  const maxCost = pricing.max_cost;
  if (maxCost == null || !Number.isFinite(maxCost)) return 0;

  const promptPrice = pricing.prompt ?? 0;
  const completionPrice = pricing.completion ?? 0;
  let gateMsats = Math.max(1, Math.floor(maxCost * 1000 * NODE_TOLERANCE));

  // The prompt window the model leaves once its answer ceiling is set aside.
  const promptTokenLimit =
    input.contextLength != null && input.contextLength > 0
      ? input.maxCompletionTokens != null && input.maxCompletionTokens > 0
        ? Math.max(0, input.contextLength - input.maxCompletionTokens)
        : input.contextLength
      : 0;
  const promptAllowanceSats = promptTokenLimit * promptPrice * NODE_TOLERANCE;

  const body = routstrChatRequestBody({
    model: input.modelId,
    messages: input.messages,
    max_tokens: input.maxTokens,
  });
  const promptTokens = Math.floor(sumStringChars(body) / NODE_CHARS_PER_TOKEN) + imageTokens;
  if (promptTokens > 0) {
    const unusedPromptBudget = promptAllowanceSats - promptTokens * promptPrice;
    if (unusedPromptBudget > 0) gateMsats -= Math.floor(unusedPromptBudget * 1000);
  }

  // Skipped for a sealed body: the node cannot read the bound it would be
  // crediting. This is the whole reason an encrypted turn reserves the model's
  // full ceiling no matter what we ask for.
  if (
    input.maxTokens > 0 &&
    pricing.max_completion_cost != null &&
    completionPrice > 0 &&
    !isSealedModelId(input.modelId)
  ) {
    const unusedCompletionBudget =
      pricing.max_completion_cost * NODE_TOLERANCE - input.maxTokens * completionPrice;
    if (unusedCompletionBudget > 0) gateMsats -= Math.floor(unusedCompletionBudget * 1000);
  }

  return Math.max(gateMsats, 1) / 1000;
}

/**
 * The reservation, in fractional sats, or `null` when pricing is unknown and
 * the honest answer is "we cannot say".
 *
 * `null` is not zero and must not be rendered as a figure — a caller with no
 * pricing has nothing true to put in front of the user and should fall back to
 * the typical-case estimate, labelled as one.
 */
function reservedSatsForRequest(input: ReserveInput): number | null {
  const pricing = input.pricing;
  if (!pricing) return null;

  const imageTokens = messageImageTokens(input.messages);
  const textChars = messageTextChars(input.messages);
  const sawPromptShape = input.messages.length > 0;
  const approximateTokens = sawPromptShape
    ? Math.ceil(textChars / SDK_CHARS_PER_TOKEN)
    : UNKNOWN_PROMPT_TOKENS;
  const totalInputTokens = approximateTokens + imageTokens;

  // The SDK's first branch: a row with no answer ceiling is not discountable
  // at all, and it reserves the whole worst case.
  if (pricing.max_completion_cost == null || pricing.max_completion_cost === 0) {
    return pricing.max_cost ?? NO_PRICING_FALLBACK_SATS;
  }

  const requestFee = pricing.request ?? 0;
  const promptCosts = (pricing.prompt ?? 0) * totalInputTokens;
  const completionCost =
    pricing.completion != null && pricing.completion > 0 && !isSealedModelId(input.modelId)
      ? pricing.completion * input.maxTokens
      : pricing.max_completion_cost;

  const componentEstimate = (promptCosts + completionCost + requestFee) * SDK_MARGIN;
  const gateEstimate = nodeGateSats(input, pricing, imageTokens) * SDK_MARGIN;

  const total = Math.max(componentEstimate, gateEstimate);
  if (pricing.max_cost != null && total > pricing.max_cost) return pricing.max_cost;
  return total;
}

/**
 * The whole sats the wallet will actually part with: the SDK mints
 * `Math.ceil(requiredSats)`, so a 306.17-sat reservation costs 307.
 */
export function reservedSatsShown(input: ReserveInput): number | null {
  const required = reservedSatsForRequest(input);
  return required == null ? null : Math.max(1, Math.ceil(required));
}

/** Tolerant number reader: the models spine validates a subset of
 *  `sats_pricing` and passes the rest through unvalidated, so every field
 *  read here is `number | undefined` at runtime whatever the type says. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Pricing from a live `/v1/models` row — the preferred source, because it is
 * the only one carrying `max_completion_cost` first-hand.
 */
function reservePricingFromModel(model: RoutstrModel | null | undefined): ReservePricing | null {
  const pricing = model?.sats_pricing as Record<string, unknown> | null | undefined;
  if (!pricing) return null;
  return {
    prompt: num(pricing.prompt),
    completion: num(pricing.completion),
    request: num(pricing.request),
    max_cost: num(pricing.max_cost),
    max_completion_cost: num(pricing.max_completion_cost),
  };
}

/**
 * Pricing from a lineup entry, for the offline case where the catalogue has
 * not landed this session.
 *
 * `max_completion_cost` is reconstructed as `completion × maxCompletionTokens`
 * because that is how the node derives it, exactly, on every catalogue row
 * seen — `306.1659 / 0.00119596 = 256000`, the row's own completion ceiling,
 * and so on for each of the ten rows in the device log. When the entry
 * predates `maxCompletionTokens` the field stays `null`, and the reservation
 * degrades to `max_cost`: the same thing the SDK does with an unpriceable row,
 * and an over-statement rather than the under-statement that caused this.
 */
export function reservePricingFromEntry(
  entry: LineupEntry | null | undefined
): ReservePricing | null {
  const pricing = entry?.satsPricing;
  if (!pricing) return null;
  const ceiling = entry?.maxCompletionTokens ?? null;
  return {
    prompt: pricing.prompt,
    completion: pricing.completion,
    request: pricing.request,
    max_cost: pricing.max_cost,
    max_completion_cost:
      pricing.completion != null && ceiling != null ? pricing.completion * ceiling : null,
  };
}

/**
 * The whole sats this send will reserve, resolved from whichever source of
 * truth the app currently holds — live catalogue first, persisted lineup
 * second, `null` when neither can price the model.
 *
 * The catalogue row also carries `top_provider`, whose context and completion
 * lengths the node gate needs; the lineup's flattened copies stand in when it
 * is absent.
 */
export function reservedSatsForSend(params: {
  entry: LineupEntry | null;
  models: readonly RoutstrModel[];
  messages: readonly RoutstrChatMessage[];
  maxTokens: number;
}): number | null {
  const { entry, models, messages, maxTokens } = params;
  if (!entry) return null;
  const model = models.find((candidate) => candidate.id === entry.modelId) ?? null;
  const pricing = reservePricingFromModel(model) ?? reservePricingFromEntry(entry);
  if (!pricing) return null;
  return reservedSatsShown({
    modelId: entry.modelId,
    pricing,
    contextLength: num(model?.top_provider?.context_length) ?? entry.contextLength ?? null,
    maxCompletionTokens:
      num(model?.top_provider?.max_completion_tokens) ?? entry.maxCompletionTokens ?? null,
    messages,
    maxTokens,
  });
}
