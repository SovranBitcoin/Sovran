/**
 * One auditor's typed reading of one mint, kept per source beside the cached
 * mint row (`mintMetadataStore.auditObservations`) and carried on discovery
 * rows. Each measured group (uptime, operations, latency) is one object, so a
 * rate's numerator and denominator, or a latency and the window it was taken
 * over, can only ever arrive together from the same source.
 *
 * Runtime leaf: zod only, so the API client, the store and the screens can all
 * import it without pulling each other in.
 *
 * Every field reads tolerantly: an observation saved by another build, or a
 * group that no longer parses, costs that group (or that observation), never
 * the mint's cached row.
 */
import { z } from 'zod';

/** Sources that write observations. Older rows may hold others; readers ignore them. */
export const AUDIT_OBSERVATION_SOURCES = [
  'mintradar',
  'ucash',
  'macadamia',
  'cashu-audit',
] as const;
export type AuditObservationSource = (typeof AUDIT_OBSERVATION_SOURCES)[number];

const Uptime = z.object({
  /** Share of checks the mint answered, 0..100. */
  pct: z.number().min(0).max(100),
  window: z.enum(['24h']),
  /** How many checks the percentage rests on, when the source says. */
  checks: z.number().int().nonnegative().optional(),
});

const Operations = z
  .object({
    okCount: z.number().int().nonnegative(),
    totalCount: z.number().int().positive(),
    /** What the counts cover: the last 7 days, the last 24 hours, or all time. */
    window: z.enum(['7d', '24h', 'all']),
  })
  .refine((ops) => ops.okCount <= ops.totalCount);

const Latency = z.object({
  ms: z.number().nonnegative(),
  kind: z.enum(['median', 'mean']),
  window: z.enum(['24h', 'all']),
});

export const AuditObservationSchema = z.object({
  source: z.string().max(32),
  /** Epoch ms when this phone read it. */
  observedAt: z.number().int().nonnegative(),
  status: z.enum(['online', 'offline', 'degraded', 'archived']).optional().catch(undefined),
  uptime: Uptime.optional().catch(undefined),
  operations: Operations.optional().catch(undefined),
  latency: Latency.optional().catch(undefined),
  /** The auditor's own id for the mint, needed for its per-mint detail calls. */
  auditorMintId: z
    .union([z.number().int().nonnegative(), z.string().max(128)])
    .optional()
    .catch(undefined),
  /** Where a person can read this auditor's page for the mint. */
  sourceUrl: z.string().max(2048).optional().catch(undefined),
});

export type AuditObservation = z.infer<typeof AuditObservationSchema>;

/**
 * The saved map, keyed by source. A value that does not parse reads as
 * `undefined` (and vanishes on the next save) without touching its siblings.
 */
export const AuditObservationsSchema = z.record(
  z.string().max(32),
  AuditObservationSchema.optional().catch(undefined)
);

export type AuditObservations = Partial<Record<string, AuditObservation | undefined>>;

const KNOWN = new Set<string>(AUDIT_OBSERVATION_SOURCES);

const GROUPS = ['status', 'uptime', 'operations', 'latency', 'auditorMintId', 'sourceUrl'] as const;
type Group = (typeof GROUPS)[number];

/**
 * A new reading from one source. A group left out keeps what the source said
 * before (a lazy uptime call says nothing about directory counts); a group set
 * to `null` is the source saying it has no such measurement now, which clears
 * the older one (CDK's 24h latency once no probe succeeded in 24h).
 */
export type AuditObservationUpdate = Pick<AuditObservation, 'source' | 'observedAt'> & {
  [K in Group]?: AuditObservation[K] | null;
};

/**
 * `incoming` over `held`, per source, newer `observedAt` winning. Unknown
 * sources and observations that do not parse are dropped, so the write side
 * holds the map to at most one entry per known source.
 */
export function mergeAuditObservations(
  held: AuditObservations | undefined,
  incoming: readonly AuditObservationUpdate[] | AuditObservations | undefined
): AuditObservations {
  const out: AuditObservations = {};
  for (const [key, value] of Object.entries(held ?? {})) {
    if (KNOWN.has(key) && value) out[key] = value;
  }
  const list = Array.isArray(incoming) ? incoming : Object.values(incoming ?? {});
  for (const candidate of list) {
    if (!candidate || typeof candidate !== 'object') continue;
    const update = candidate as AuditObservationUpdate;
    if (!KNOWN.has(update.source)) continue;
    const prev = out[update.source];
    if (prev && prev.observedAt > update.observedAt) continue;
    const next: Record<string, unknown> = {
      ...prev,
      source: update.source,
      observedAt: update.observedAt,
    };
    for (const group of GROUPS) {
      const value = update[group];
      if (value === null) delete next[group];
      else if (value !== undefined) next[group] = value;
    }
    const parsed = AuditObservationSchema.safeParse(next);
    if (!parsed.success) continue;
    // Groups that failed their own check read as undefined; leave them out.
    out[update.source] = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined)
    ) as AuditObservation;
  }
  return out;
}

/** A source's reading, when it parses. */
export function observationFrom(
  map: AuditObservations | undefined,
  source: AuditObservationSource
): AuditObservation | undefined {
  const value = map?.[source];
  return value && typeof value === 'object' ? value : undefined;
}
