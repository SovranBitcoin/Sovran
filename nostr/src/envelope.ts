import { z } from "zod";
import { NaggFeedEventSchema, NostrHexId } from "./schemas";
import type { NaggFeedEvent } from "./map/feed";
import { supersedes } from "./replaceable";

// ---------------------------------------------------------------------------
// nagg v2 envelope — ONE generic response shape for every app-view route
//
// nagg v2 collapses the per-route response bodies into a single envelope:
//
//   { order, orderBy, events, aggregates, cursor? }
//
// - `order` is the server-authoritative render order of ANCHOR event ids. For a
//   kind-6/16 repost item the anchor is the REFERENCED (original) event id, not
//   the repost's own id.
// - `events` carries the ordered items PLUS hydration: repost originals, thread
//   roots, quoted (q-tag) events, and each author's kind-0 profile event.
// - `aggregates` maps target id (event id — or pubkey on profile routes) →
//   rule name → metric → value. ZERO VALUES ARE OMITTED ENTIRELY, so every
//   accessor here defaults to 0.
// - `cursor` is opaque; echo it back for the next page. The feed routes encode
//   `"<until>|<offset>"`.
//
// This module is the ONE parser for that envelope: zod schemas for the envelope
// and its route extensions (profile providers and identities), plus the
// event and kind-0 profile helpers the facade's surviving surfaces read.
// ---------------------------------------------------------------------------

/** One event's counts: `[rule][metric] = number`. Rule and metric names are short. */
const AggregateRules = z.record(
  z.string().max(128),
  z.record(z.string().max(128), z.number()),
);

/**
 * `aggregates[id][rule][metric]`, read one id at a time: an id whose counts do
 * not parse (or whose key is not plausibly an id) loses its counts, and the
 * rest of the page keeps theirs.
 */
export const NaggAggregatesSchema = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((v): NaggAggregates => {
    const out: NaggAggregates = {};
    for (const [id, rules] of Object.entries(v ?? {})) {
      if (id.length > 128) continue;
      const parsed = AggregateRules.safeParse(rules);
      if (parsed.success) out[id] = parsed.data;
    }
    return out;
  });

/**
 * An array whose items arrive from the network one by one: an item that does
 * not parse is left out instead of failing the whole array. One malformed or
 * oversized event must not cost the page it came on. A Go nil slice serializes
 * to `null`, not `[]`, so both read as empty and an empty view never fails the
 * parse and silently drops a whole tier.
 */
function tolerantArrayOrEmpty<T extends z.ZodTypeAny>(value: T) {
  return z
    .array(z.unknown())
    .nullish()
    .transform((items): Array<z.infer<T>> =>
      (items ?? []).flatMap((item) => {
        const parsed = value.safeParse(item);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      }),
    );
}

export const NaggEnvelopeSchema = z
  .object({
    // Ids, or keys built from them; an element longer than any of those is left out.
    order: tolerantArrayOrEmpty(z.string().max(512)),
    orderBy: z.enum(["created_at", "rank"]).catch("created_at"),
    events: tolerantArrayOrEmpty(NaggFeedEventSchema),
    aggregates: NaggAggregatesSchema,
    // Opaque and echoed back; one too long to be a cursor is read as none.
    cursor: z.string().max(2048).nullish().catch(null),
    hasMore: z.boolean().nullish(),
  })
  .passthrough();

const ProviderFields = z.record(
  z.string().max(64),
  z.record(z.string().max(64), z.unknown()),
);

/** Per-provider enrichment on the profile routes, e.g. `vertex.{rank,score}`, `nip05.valid`. */
export const NaggProvidersSchema = z
  .record(z.string(), z.unknown())
  .transform((providers) => {
    // Keyed by pubkey and read one at a time: a key that is not a pubkey, or a
    // value of the wrong shape, costs that pubkey its enrichment and no more.
    const out: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const [pubkey, raw] of Object.entries(providers)) {
      if (!NostrHexId.safeParse(pubkey).success) continue;
      const parsed = ProviderFields.safeParse(raw);
      if (parsed.success) out[pubkey] = parsed.data;
    }
    return out;
  });

/** A number nagg could not establish is `null`, never 0 — kept as null here. */
const nullableNumber = z
  .number()
  .nullish()
  .transform((v): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null,
  );

/** Mint / provider URL lists; a real operator runs a handful, so 64 is generous. */
const stringList = z
  .array(z.string().max(512))
  .max(64)
  .nullish()
  .transform((v): string[] => v ?? []);

/**
 * One pubkey's identity group, as every nagg route that names a pubkey now
 * carries it under `identities[<hex>]`: the kind-0 fields it knows, the
 * operator's reach and Vertex figures, and what the pubkey operates. This is
 * the wire shape behind the entity cache's profile stats — a figure seen on
 * ANY route is the figure every surface shows.
 *
 * Tolerant per field: a route that omits a block (a mint-only deployment
 * has no `firstEventAt`) still parses, and a field nagg adds later passes.
 */

export const NaggIdentitySchema = z
  .object({
    pubkey: NostrHexId,
    npub: z.string().max(128).nullish(),
    profile: z
      .object({
        name: z.string().max(256).optional(),
        displayName: z.string().max(256).optional(),
        picture: z.string().max(2048).optional(),
        banner: z.string().max(2048).optional(),
        about: z.string().max(4096).optional(),
        nip05: z.string().max(256).optional(),
        nip05Valid: z.boolean().optional(),
        website: z.string().max(2048).optional(),
        lud16: z.string().max(256).optional(),
        lud06: z.string().max(2048).optional(),
      })
      .passthrough()
      .nullish(),
    reach: z
      .object({
        followers: nullableNumber,
        follows: nullableNumber,
        source: z.enum(["graph", "vertex", "relays"]).nullish(),
      })
      .nullish()
      .transform((v) => v ?? { followers: null, follows: null, source: null }),
    vertex: z
      .object({
        rank: nullableNumber,
        score: nullableNumber,
        fetchedAt: nullableNumber,
      })
      .nullish()
      .transform((v) => v ?? { rank: null, score: null, fetchedAt: null }),
    operates: z
      .object({ mints: stringList, aiProviders: stringList })
      .nullish()
      .transform((v) => v ?? { mints: [], aiProviders: [] }),
    firstEventAt: nullableNumber,
  })
  .passthrough();

/**
 * Keyed by hex pubkey. One malformed entry (a bad key, an oversized field)
 * is dropped rather than failing the whole response — a route's payload must
 * not disappear because one operator's profile is odd. Capped at 512 entries;
 * no route names more pubkeys than that.
 */
export const NaggIdentitiesSchema = z
  .record(z.string().max(64), NaggIdentitySchema.optional().catch(undefined))
  .nullish()
  .transform((v): Record<string, NaggIdentity> => {
    const out: Record<string, NaggIdentity> = {};
    if (!v) return out;
    let n = 0;
    for (const [key, identity] of Object.entries(v)) {
      if (!identity || !NostrHexId.safeParse(key).success || n >= 512) continue;
      out[key] = identity;
      n += 1;
    }
    return out;
  });

export const NaggProfilesEnvelopeSchema = NaggEnvelopeSchema.extend({
  /** Complete ranked pubkey list (includes profiles without a local kind-0). */
  pubkeys: tolerantArrayOrEmpty(NostrHexId),
  providers: NaggProvidersSchema.nullish().transform(
    (v): z.infer<typeof NaggProvidersSchema> => v ?? {},
  ),
  identities: NaggIdentitiesSchema,
  fromCache: z.boolean().optional(),
  vertexFresh: z.boolean().nullish(),
});

export type NaggAggregates = Record<
  string,
  Record<string, Record<string, number>>
>;
export type NaggEnvelope = z.infer<typeof NaggEnvelopeSchema>;
export type NaggIdentity = z.infer<typeof NaggIdentitySchema>;
export type NaggProfilesEnvelope = z.infer<typeof NaggProfilesEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Aggregate rules — server rule names → the friendly fields the facade exposes
// ---------------------------------------------------------------------------

export const AGGREGATE_RULES = {
  /** Reaction/like count (distinct reactors). */
  likeCount: { rule: "k7_e", metric: "actors" },
  /** Repost count (distinct reposters, kinds 6/16). */
  repostCount: { rule: "k6_16_e", metric: "actors" },
  /** Reply count (kind 1/1111 replies). */
  replyCount: { rule: "k1_1111_e_reply", metric: "sources" },
  /** Quote count (kind-1 q-tag quotes). */
  quoteCount: { rule: "k1_q", metric: "sources" },
  /** Total sats zapped. */
  satsZapped: { rule: "k9735_e", metric: "value_total" },
  /** Zap receipt count. */
  zapCount: { rule: "k9735_e", metric: "sources" },
  /** Vertex-gated "real" like count. */
  realLikeCount: { rule: "vertex_k7_e", metric: "actors" },
  /** Distinct vertex-scored ("real") engagers across all engagement kinds. */
  realEngagerCount: { rule: "vertex_actors", metric: "actors" },
  // --- pubkey-keyed (profile routes) ---
  /** Followers: distinct authors whose latest kind-3 p-tags the pubkey. */
  followers: { rule: "k3_p_latest", metric: "actors" },
  /** Following: p-tag count of the pubkey's own latest kind-3. */
  following: { rule: "k3_author_latest", metric: "sources" },
  /** Created-event (post) count. */
  postCount: { rule: "k1_1111_author", metric: "sources" },
} as const;

export type AggregateRuleName = keyof typeof AGGREGATE_RULES;

/**
 * Raw accessor: the value of one rule metric for one target (event id or
 * pubkey), or `undefined` when the server omitted it (zero values are omitted).
 */
export function aggregateValue(
  aggregates: NaggAggregates,
  targetId: string,
  name: AggregateRuleName,
): number | undefined {
  const { rule, metric } = AGGREGATE_RULES[name];
  return aggregates[targetId]?.[rule]?.[metric];
}

// ---------------------------------------------------------------------------
// Profiles — kind-0 extraction
// ---------------------------------------------------------------------------

export type ProfileMetadata = {
  name?: string;
  displayName?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  /** Legacy LNURL-pay (`lnurl1…`) payment target; `lud16` wins when both are set. */
  lud06?: string;
  website?: string;
  about?: string;
};

/**
 * Parse a kind-0 event's `content` JSON into ProfileMetadata. Tolerant: unknown
 * fields ignored, `display_name`/`displayName` both accepted, null on bad JSON.
 */
export function parseProfileMetadata(content: string): ProfileMetadata | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined;
  const metadata: ProfileMetadata = {
    name: str(o.name),
    displayName: str(o.display_name) ?? str(o.displayName),
    picture: str(o.picture),
    banner: str(o.banner),
    nip05: str(o.nip05),
    lud16: str(o.lud16),
    lud06: str(o.lud06),
    website: str(o.website),
    about: str(o.about),
  };
  // Drop a profile that carried nothing useful.
  return Object.values(metadata).some((v) => v !== undefined) ? metadata : null;
}

/** Latest kind-0 event per pubkey found in the envelope's hydration. */
export function latestKind0ByPubkey(
  envelope: NaggEnvelope,
): Map<string, NaggFeedEvent> {
  const latest = new Map<string, NaggFeedEvent>();
  for (const event of envelope.events) {
    if (event.kind !== 0) continue;
    const current = latest.get(event.pubkey);
    if (!current || supersedes(event, current)) latest.set(event.pubkey, event);
  }
  return latest;
}

/** Full kind-0 metadata per pubkey (for the search/profile surfaces). */
export function profileMetadataByPubkey(
  envelope: NaggEnvelope,
): Record<string, ProfileMetadata> {
  const out: Record<string, ProfileMetadata> = {};
  for (const [pubkey, event] of latestKind0ByPubkey(envelope)) {
    const metadata = parseProfileMetadata(event.content);
    if (metadata) out[pubkey] = metadata;
  }
  return out;
}
