import type { LegacyMintAudit } from '@/shared/stores/global/mintMetadataTypes';

/** Read independent auditor reports without serial network waits or an unbounded burst. */
export async function fetchRebalanceRouteAudits(
  candidates: readonly string[],
  fetchAudit: (mintUrl: string) => Promise<LegacyMintAudit | null>
): Promise<LegacyMintAudit[]> {
  const reports: (LegacyMintAudit | null)[] = new Array(candidates.length);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const index = next++;
      reports[index] = await fetchAudit(candidates[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, worker));
  // Graph construction must see the same candidate order as the serial path,
  // regardless of which host answers first.
  return reports.filter((report): report is LegacyMintAudit => report !== null);
}
