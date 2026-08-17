import type { AuditMintResponse } from '@/shared/lib/apiClient';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataStore';

interface AuditInfo {
  url: string;
  name: string;
  state: string;
  /** 0-5 score derived from successRate (swap-based), used by some UI */
  score?: number;
  /** Swap success rate in range [0..1], computed from recent swaps (typically last 100) */
  successRate?: number;
  /** Recent swap window size used for successRate (e.g. 100) */
  swapTotal?: number;
  /** Successful swaps (state === 'OK') in the recent window */
  swapSuccess?: number;
  /** Average time_taken (ms) for successful swaps with time_taken > 0 */
  avgTimeMs?: number;
  auditorData: {
    name: string;
    state: string;
    mints: number;
    melts: number;
    errors: number;
  };
}

/**
 * Reduce the auditor's per-mint response to the swap-based metrics the
 * mint UI surfaces ("100 of 100 swaps", score chips, latency chips).
 * Identical results were hand-coded twice in `useAuditedMint` and
 * `useAuditedMints`; this is the single canonical implementation.
 */
export function transformAuditData(auditData: AuditMintResponse): AuditInfo {
  const swaps = auditData.swaps || [];
  const swapTotal = swaps.length;
  const swapSuccess = swaps.reduce((acc, s) => acc + (s.state === 'OK' ? 1 : 0), 0);
  const successRate = swapTotal > 0 ? swapSuccess / swapTotal : undefined;
  const score = typeof successRate === 'number' ? successRate * 5 : undefined;

  const successfulTimes = swaps
    .filter((s) => s.state === 'OK' && typeof s.time_taken === 'number' && s.time_taken > 0)
    .map((s) => s.time_taken);
  const avgTimeMs =
    successfulTimes.length > 0
      ? successfulTimes.reduce((sum, t) => sum + t, 0) / successfulTimes.length
      : undefined;

  return {
    url: auditData.url,
    name: auditData.name,
    state: auditData.state,
    score,
    successRate,
    swapTotal,
    swapSuccess,
    avgTimeMs,
    auditorData: {
      name: auditData.name,
      state: auditData.state,
      mints: auditData.n_mints,
      melts: auditData.n_melts,
      errors: auditData.n_errors,
    },
  };
}

/** Normalized presentation scalars projected from a cached metadata entry. */
interface MintMetaProjection {
  kymScore?: number;
  reviewCount?: number;
  contactFollowers?: number;
  /** rounded to a whole number */
  contactReputation?: number;
  auditScore?: number;
  auditState?: string;
  /** n_mints */
  auditMints?: number;
  /** n_melts */
  auditMelts?: number;
  /** full swap breakdown — present only when the raw auditor blob is cached */
  audit?: AuditInfo;
}

/**
 * Single owner for "given a cached mint metadata entry, here are the
 * presentation scalars." Both the catalog reader (`getMintCatalog`) and the
 * send-flow enrichment bridge project the same audit/review/social fields;
 * centralizing the raw-blob-vs-discover-scalars fallback and the reputation
 * rounding here keeps them from drifting (the swap-score formula lives only in
 * `transformAuditData`). Lives next to that transform — a runtime leaf — so
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

  if (meta.auditData) {
    const audit = transformAuditData(meta.auditData);
    p.audit = audit;
    if (audit.score !== undefined) p.auditScore = audit.score;
    p.auditState = audit.state;
    p.auditMints = audit.auditorData.mints;
    p.auditMelts = audit.auditorData.melts;
  } else if (meta.auditState !== undefined || meta.auditScore != null) {
    // Discover-seeded entries carry audit scalars without the raw swap blob.
    if (meta.auditScore != null) p.auditScore = meta.auditScore;
    if (meta.auditState !== undefined) p.auditState = meta.auditState;
    if (meta.nMints != null) p.auditMints = meta.nMints;
    if (meta.nMelts != null) p.auditMelts = meta.nMelts;
  }
  return p;
}
