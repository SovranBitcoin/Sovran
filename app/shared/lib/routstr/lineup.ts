import { z } from 'zod';

import { tolerantRecord } from '@/shared/lib/persist/tolerant';

/**
 * The AI model lineup's ids and saved shape. The AI tab that derived and
 * showed it is gone; `routstrStore` still reads a lineup saved by 0.1.x, so
 * its schema stays here under the released shape.
 */

/**
 * Provider / tier id unions. Single source of truth — `features/ai/lib/
 * format.ts` (UI metadata) and `routstrStore` (selection guards) both
 * import these, which is what keeps the two ends of the (provider, tier)
 * selection contract in lockstep by construction.
 */
/**
 * The vendors the app knows by name, in the order they are offered.
 *
 * NOT the whole list. The catalog carries around fifty vendors and roughly
 * half of them can fill a complete tier ladder, so pinning the menu to four
 * was hand-picking dressed as a contract — and it is why the picker showed a
 * fraction of what the node actually serves. These four lead because they are
 * the names a user recognises and because `openai` is the boot default;
 * everything else the catalog qualifies follows them.
 */
export const AI_PROVIDER_IDS = ['openai', 'claude', 'grok', 'google'] as const;

/**
 * The vendor id encrypted models are offered under.
 *
 * They get a vendor of their own rather than being folded into the vendor
 * that trained them, because a tier ladder mixing sealed and plaintext models
 * cannot promise either one: the tier picks are price-ordered and the sealed
 * rows are the dearer ones, so a mixed ladder would resolve to a plaintext
 * model at every tier and the "end-to-end encrypted" badge would never be
 * kept. One vendor whose every model is sealed is the only shape where
 * choosing it means what it says.
 */
export const E2EE_PROVIDER_ID = 'tinfoil';

/**
 * A vendor id. A string, not a union: the set comes from the catalog, and a
 * union would mean a Sovran release every time a vendor appeared on a node.
 * `AI_PROVIDER_IDS` remains the known-and-named subset.
 */
export type AiProviderId = string;

export const AI_TIER_IDS = ['auto', 'pro', 'max'] as const;
export type AiTierId = (typeof AI_TIER_IDS)[number];

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
   * The node's id for the upstream account serving this model
   * (`openrouter`, `tinfoil`, …). Models sharing one are a single failure
   * domain: a node whose credit with one upstream is exhausted answers 402
   * for every model behind it while its catalog, wallet and other upstreams
   * stay healthy — so retrying a sibling from the same upstream only pays to
   * be refused again. Additive + optional: absent on lineups persisted before
   * this field existed and on nodes too old to report it, in which case the
   * send path simply cannot narrow and behaves as it did.
   */
  upstreamId: z.string().max(64).nullable().catch(null).optional(),
  /**
   * True when this entry was substituted from the persisted last-known
   * lineup because a successful fetch returned zero qualifying models for
   * its provider. Rendered as a "last known" annotation; the id may be
   * dead on the API, which the send-path candidate chain absorbs.
   */
  lastKnown: z.boolean().optional(),
});

const ProviderLineupSchema = z.object({
  auto: LineupEntrySchema.nullable().catch(null),
  pro: LineupEntrySchema.nullable().catch(null),
  max: LineupEntrySchema.nullable().catch(null),
});
type ProviderLineup = z.infer<typeof ProviderLineupSchema>;

/**
 * Keyed by vendor id rather than by four fixed keys.
 *
 * Read-compatible with every blob written under the old fixed shape — those
 * were `{openai, claude, grok, google}`, which is a record of exactly this
 * value type — so this widens the schema without touching a byte of persisted
 * data. `tolerantRecord`, so one malformed vendor costs that vendor rather
 * than the whole `routstr-store` blob.
 */
const AiLineupSchema = tolerantRecord(z.string().max(64), ProviderLineupSchema);
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
  nodeBaseUrl: z.string().max(512).nullable().optional().catch(null),
  lineup: AiLineupSchema,
});
export type PersistedLineup = z.infer<typeof PersistedLineupSchema>;

const emptyProviderLineup = (): ProviderLineup => ({ auto: null, pro: null, max: null });

/**
 * A lineup with the four known vendors present and empty.
 *
 * The known four are kept as a floor rather than dropped, so every existing
 * consumer that reaches for `lineup.openai` still finds a block, and a catalog
 * that qualifies more vendors simply adds keys beside them.
 */
export const emptyLineup = (): AiLineup => ({
  openai: emptyProviderLineup(),
  claude: emptyProviderLineup(),
  grok: emptyProviderLineup(),
  google: emptyProviderLineup(),
});

/**
 * The vendors this lineup actually offers, in its own order.
 *
 * Filtered to vendors with at least one tier filled: an empty block is a
 * placeholder, and a tab for it would open onto nothing.
 */
export function lineupProviderIds(lineup: AiLineup | null | undefined): AiProviderId[] {
  if (!lineup) return [];
  return Object.keys(lineup).filter((provider) => providerHasEntries(lineup[provider]));
}

/**
 * True when at least one cell anywhere in the lineup is filled.
 *
 * Null-tolerant on purpose: "no lineup at all" and "a lineup whose every cell
 * is empty" are the same answer to every caller that asks this, and the two
 * states are one keystroke apart in a store where `lineup` is nullable. The
 * empty object is the one that hides — it is truthy, so a `??` fallback chain
 * stops at it — which is exactly the confusion that left the model picker
 * showing "Models loading" over a catalog that had already landed.
 */
export function lineupHasEntries(lineup: AiLineup | null | undefined): boolean {
  if (!lineup) return false;
  return Object.values(lineup).some(providerHasEntries);
}

function providerHasEntries(provider: ProviderLineup): boolean {
  return AI_TIER_IDS.some((t) => provider[t] != null);
}
