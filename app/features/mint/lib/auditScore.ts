/**
 * The ONE owner of the mint audit score (0..5). Two sources feed it:
 *
 * - operation counts (nagg discovery / the auditor's `n_mints`, `n_melts`,
 *   `n_errors`): `n_errors` is a SEPARATE count of failed operations, not a
 *   subset of the successes, so the rate is successes / (successes + errors),
 *   bounded 0..1. (The old `1 - errors/successes` went deeply negative for
 *   error-heavy mints.)
 * - recent swap outcomes (the auditor's per-swap array): success rate × 5.
 *
 * Runtime leaf: no store or network imports, so any consumer can use it.
 */

interface AuditOpsCounts {
  nMints?: number;
  nMelts?: number;
  nErrors?: number;
}

/** Score from operation counts; `null` when any count is unknown or no operations were recorded. */
export function auditScoreFromOps(counts: AuditOpsCounts): {
  score: number | null;
  totalOps: number;
} {
  const { nMints, nMelts, nErrors } = counts;
  if (nMints === undefined || nMelts === undefined || nErrors === undefined) {
    return { score: null, totalOps: 0 };
  }
  const successes = nMints + nMelts;
  const totalOps = successes + nErrors;
  if (!(totalOps > 0)) return { score: null, totalOps: 0 };
  const rate = Math.max(0, Math.min(1, successes / totalOps));
  return { score: rate * 5, totalOps };
}

/** Score from a recent-swap success rate (0..1); `undefined` when no swaps were observed. */
export function auditScoreFromSwaps(successRate: number | undefined): number | undefined {
  if (typeof successRate !== 'number' || Number.isNaN(successRate)) return undefined;
  return Math.max(0, Math.min(1, successRate)) * 5;
}
