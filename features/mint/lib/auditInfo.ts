import type { AuditMintResponse } from '@/shared/lib/apiClient';

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
