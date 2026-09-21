import type { DiscoverMint } from '@/shared/lib/apiClient';
import type { LegacyMintAudit, MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';
import { auditScoreFromOps } from './auditScore';

/**
 * The cached fields one auditor row owns. They are written and cleared
 * together so an entry never holds one auditor's counts beside another's
 * latency.
 */
type MintAuditGroup = Pick<
  MintMetadataEntry,
  | 'auditState'
  | 'nMints'
  | 'nMelts'
  | 'nErrors'
  | 'auditScore'
  | 'uptime24h'
  | 'avgLatencyMs'
  | 'auditSource'
  | 'auditUpdatedAt'
>;

const NO_AUDIT: MintAuditGroup = {
  auditState: undefined,
  nMints: undefined,
  nMelts: undefined,
  nErrors: undefined,
  auditScore: undefined,
  uptime24h: undefined,
  avgLatencyMs: undefined,
  auditSource: undefined,
  auditUpdatedAt: undefined,
};

/**
 * Normalize the audit half of a nagg `/nostr/mint/discover` row. Nagg has
 * already chosen the auditor for the mint: a ucash row (the newer auditor) wins,
 * and the 8333 row (the older one) fills the mints ucash does not track.
 *
 * Every key is returned, absent ones as `undefined`, so spreading the result
 * over a cached entry REPLACES the previous auditor's row instead of leaving
 * its fields behind. `hasAudit: false` is nagg's answer that no auditor tracks
 * the mint (it still sends zero counts), which clears the group. `undefined`
 * means the row said nothing about audit, so the cached group is left alone.
 */
export function auditGroupFromDiscover(m: DiscoverMint): MintAuditGroup | undefined {
  const hasAuditFields =
    m.state !== undefined ||
    m.nMints !== undefined ||
    m.nMelts !== undefined ||
    m.nErrors !== undefined ||
    m.uptime24h !== undefined ||
    m.avgLatencyMs !== undefined;
  if (m.hasAudit === false) return NO_AUDIT;
  if (m.hasAudit === undefined && !hasAuditFields) return undefined;
  return {
    auditState: m.state,
    nMints: m.nMints,
    nMelts: m.nMelts,
    nErrors: m.nErrors,
    auditScore: auditScoreFromOps(m).score,
    uptime24h: m.uptime24h,
    avgLatencyMs: m.avgLatencyMs,
    auditSource: m.auditSource,
    auditUpdatedAt: m.auditUpdatedAt,
  };
}

/** One auditor's view of a mint, as every mint surface displays it. */
export interface MintAuditSummary {
  /** The auditor that measured this; `undefined` when the cached row names none. */
  source: MintMetadataEntry['auditSource'];
  state?: string;
  /** successes / (successes + errors), 0..1; `undefined` until an operation was recorded. */
  successRate?: number;
  /** `successRate` on the 0..5 scale the row pills use. */
  score?: number;
  /** The operations behind `successRate`: successes plus errors. */
  totalOps?: number;
  mints?: number;
  melts?: number;
  avgLatencyMs?: number;
}

function summarize(
  source: MintAuditSummary['source'],
  state: string | undefined,
  counts: { nMints?: number; nMelts?: number; nErrors?: number },
  avgLatencyMs: number | undefined
): MintAuditSummary | undefined {
  const { score, totalOps } = auditScoreFromOps(counts);
  // Zero counts with no state is what an unaudited mint looks like in cache.
  if (state === undefined && score === null && avgLatencyMs === undefined) return undefined;
  const summary: MintAuditSummary = { source };
  if (state !== undefined) summary.state = state;
  if (score !== null) {
    summary.successRate = score / 5;
    summary.score = score;
    summary.totalOps = totalOps;
  }
  if (counts.nMints !== undefined) summary.mints = counts.nMints;
  if (counts.nMelts !== undefined) summary.melts = counts.nMelts;
  if (avgLatencyMs !== undefined) summary.avgLatencyMs = avgLatencyMs;
  return summary;
}

/** Mean `time_taken` of the successful swaps in a retired-API blob. */
function legacyAvgLatencyMs(auditData: LegacyMintAudit): number | undefined {
  const times = (auditData.swaps || [])
    .filter((s) => s.state === 'OK' && typeof s.time_taken === 'number' && s.time_taken > 0)
    .map((s) => s.time_taken);
  if (times.length === 0) return undefined;
  return times.reduce((sum, t) => sum + t, 0) / times.length;
}

/**
 * The ONE reading of a cached entry's audit. The mint list rows, the Add Mints
 * rows and the mint info page all display this, so they agree by construction.
 *
 * One source per summary, never a blend:
 *   1. the nagg discovery group (ucash preferred, 8333 as nagg's fallback);
 *   2. only when that group is empty, the 8333 blob kept from the retired audit
 *      API (`auditData`), read whole.
 * The rate always comes from the chosen source's operation counts, so a number
 * means the same thing whichever auditor supplied it.
 */
export function selectMintAudit(
  entry: MintMetadataEntry | undefined
): MintAuditSummary | undefined {
  if (!entry) return undefined;
  const discovered = summarize(entry.auditSource, entry.auditState, entry, entry.avgLatencyMs);
  if (discovered) return discovered;
  const legacy = entry.auditData;
  if (!legacy) return undefined;
  return summarize(
    '8333',
    legacy.state,
    { nMints: legacy.n_mints, nMelts: legacy.n_melts, nErrors: legacy.n_errors },
    legacyAvgLatencyMs(legacy)
  );
}

/** Normalized presentation scalars projected from a cached metadata entry. */
interface MintMetaProjection {
  kymScore?: number;
  reviewCount?: number;
  contactFollowers?: number;
  /** rounded to a whole number */
  contactReputation?: number;
  audit?: MintAuditSummary;
}

/**
 * Single owner for "given a cached mint metadata entry, here are the
 * presentation scalars." The catalog reader (`getMintCatalog`), the send-flow
 * enrichment bridge and the mint detail read project the same
 * audit/review/social fields; centralizing the audit selection and the
 * reputation rounding here keeps them from drifting. A runtime leaf, so
 * importing it never drags the network layer into a consumer.
 */
export function projectMintMeta(meta: MintMetadataEntry | undefined): MintMetaProjection {
  const p: MintMetaProjection = {};
  if (!meta) return p;

  if (meta.averageScore != null) p.kymScore = meta.averageScore;
  if (meta.reviewCount != null) p.reviewCount = meta.reviewCount;
  if (meta.contactFollowers != null) p.contactFollowers = meta.contactFollowers;
  if (typeof meta.contactReputation === 'number') {
    p.contactReputation = Math.round(meta.contactReputation);
  }
  const audit = selectMintAudit(meta);
  if (audit) p.audit = audit;
  return p;
}
