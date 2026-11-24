/**
 * Mint Info's own per-mint auditor reads, made when the page opens and never
 * from discovery (a directory of N mints must not cost N detail calls).
 *
 * - MintRadar: the single-mint endpoint, for 24h uptime, the 7-day swap
 *   probes and the 24h median latency.
 * - Each enabled CDK auditor (uCash, Macadamia): `get_mint_uptime` and
 *   `get_mint_metrics`, by the auditor's own mint id. The id comes from the
 *   reading discovery saved; when there is none, one host search finds it.
 *
 * A source that fails, answers 404 or sends an unexpected shape adds nothing
 * and fails nothing: the page shows whatever the other sources said.
 */
import {
  cdkDetailObservation,
  fetchCdkMintMetrics,
  fetchCdkMintUptime,
  fetchMintRadarSingle,
  findCdkMint,
} from '@/shared/lib/cashu/auditors/adapters';
import {
  observationFrom,
  type AuditObservations,
  type AuditObservationUpdate,
} from '@/shared/lib/cashu/auditors/observation';
import { resolveEnabledAuditors, type CdkAuditorId } from '@/shared/lib/cashu/auditors/registry';
import { normalizeMintUrlKey } from '@/shared/lib/url';

/** Opening the same mint again within this long reuses the last reads. */
export const MINT_AUDIT_DETAIL_TTL_MS = 10 * 60 * 1000;

/** When each mint's detail was last read this session (not saved). */
const lastReadAt = new Map<string, number>();

/** For tests. */
export function resetMintAuditDetailClock(): void {
  lastReadAt.clear();
}

export function mintAuditDetailDue(mintUrl: string, nowMs: number): boolean {
  const at = lastReadAt.get(normalizeMintUrlKey(mintUrl));
  return at === undefined || nowMs - at >= MINT_AUDIT_DETAIL_TTL_MS;
}

interface MintAuditDetailDeps {
  fetchMintRadarSingle: typeof fetchMintRadarSingle;
  findCdkMint: typeof findCdkMint;
  fetchCdkMintUptime: typeof fetchCdkMintUptime;
  fetchCdkMintMetrics: typeof fetchCdkMintMetrics;
}

const DEFAULT_DEPS: MintAuditDetailDeps = {
  fetchMintRadarSingle,
  findCdkMint,
  fetchCdkMintUptime,
  fetchCdkMintMetrics,
};

async function readCdk(
  id: CdkAuditorId,
  mintUrl: string,
  held: AuditObservations | undefined,
  signal: AbortSignal,
  deps: MintAuditDetailDeps
): Promise<AuditObservationUpdate[]> {
  const updates: AuditObservationUpdate[] = [];
  let auditorMintId = observationFrom(held, id)?.auditorMintId;
  if (auditorMintId === undefined) {
    const found = await deps.findCdkMint(id, mintUrl, { signal });
    if (!found?.observation) return updates;
    updates.push(found.observation);
    auditorMintId = found.observation.auditorMintId ?? undefined;
    if (auditorMintId === undefined) return updates;
  }
  const [uptime, metrics] = await Promise.all([
    deps.fetchCdkMintUptime(id, auditorMintId, { signal }),
    deps.fetchCdkMintMetrics(id, auditorMintId, { signal }),
  ]);
  if (uptime || metrics) updates.push(cdkDetailObservation(id, { uptime, metrics }, Date.now()));
  return updates;
}

/**
 * Every enabled source's per-mint reading, as updates for
 * `mintMetadataStore.recordAuditObservations`. Never throws. Returns whether
 * any source answered, so the page can tell "nothing known" from "offline".
 */
export async function readMintAuditDetail(
  mintUrl: string,
  options: {
    held: AuditObservations | undefined;
    disabledAuditors: readonly string[];
    enabledAuditors: readonly string[];
    signal: AbortSignal;
    deps?: Partial<MintAuditDetailDeps>;
  }
): Promise<{ updates: AuditObservationUpdate[]; answered: boolean }> {
  const deps = { ...DEFAULT_DEPS, ...options.deps };
  const enabled = resolveEnabledAuditors(options.disabledAuditors, options.enabledAuditors);
  lastReadAt.set(normalizeMintUrlKey(mintUrl), Date.now());

  const reads: Promise<AuditObservationUpdate[]>[] = [];
  if (enabled.includes('mintradar')) {
    reads.push(
      deps
        .fetchMintRadarSingle(mintUrl, { signal: options.signal })
        .then((summary) => (summary ? [summary.observation] : []))
    );
  }
  for (const id of ['ucash', 'macadamia'] as const) {
    if (enabled.includes(id)) reads.push(readCdk(id, mintUrl, options.held, options.signal, deps));
  }
  const settled = await Promise.allSettled(reads);
  const updates: AuditObservationUpdate[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') updates.push(...outcome.value);
  }
  if (options.signal.aborted) {
    // Let the next open try again instead of waiting out the TTL.
    lastReadAt.delete(normalizeMintUrlKey(mintUrl));
  }
  return { updates, answered: updates.length > 0 };
}
