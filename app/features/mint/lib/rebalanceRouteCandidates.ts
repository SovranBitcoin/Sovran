import type { GetInfoResponse } from '@cashu/cashu-ts';
import type { RebalanceRoute } from 'wallet';

import {
  addLocalHistoryEdges,
  buildSwapGraph,
  getLocalCandidatesForDestination,
  pickIntermediaryPath,
  type TransferStep,
} from '@/features/mint/components/rebalance';
import { createMiddlemanCandidateRoutes } from '@/features/mint/lib/rebalanceRunState';
import { fetchRebalanceRouteAudits } from '@/features/mint/lib/rebalanceRouteAudits';
import { getDiscoveredMintMetadata } from '@/shared/lib/getDiscoveredMintMetadata';
import { extractDomain } from '@/shared/lib/url';
import type { MiddlemanRoutingSettings } from '@/shared/stores/global/settingsStore';
import type { LegacyMintAudit } from '@/shared/stores/global/mintMetadataTypes';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';

/** Each candidate can cost a discovery call, and this runs after a failure. */
const MAX_GRAPH_CANDIDATES = 12;

async function fetchAudit(mintUrl: string): Promise<LegacyMintAudit | null> {
  const metadata = await getDiscoveredMintMetadata(mintUrl);
  // Discovery aggregates cannot establish edges between mints. Use only
  // retained swap observations here; local history is merged separately.
  return metadata?.auditData ?? null;
}

/**
 * Candidate middleman routes for a transfer Lightning could not route, best
 * first: the scored auditor + local-history graph path, then every mint our
 * own history has seen reach the destination.
 */
export async function findRebalanceRouteCandidates({
  fromMintUrl,
  toMintUrl,
  planSteps,
  trustedMintUrls,
  mintInfoMap,
  middlemanRouting,
}: {
  fromMintUrl: string;
  toMintUrl: string;
  /** Steps of the running plan; null before a run starts (no graph search). */
  planSteps: readonly TransferStep[] | null;
  trustedMintUrls: readonly string[];
  mintInfoMap: Record<string, GetInfoResponse | null>;
  middlemanRouting: MiddlemanRoutingSettings;
}): Promise<RebalanceRoute[]> {
  const swapGroups = Object.values(useSwapTransactionsStore.getState().groups);
  const localFallbacks = getLocalCandidatesForDestination(swapGroups, toMintUrl, fromMintUrl);

  let suggestion: { path: string[]; pathNames: string[] } | null = null;
  if (planSteps) {
    // Plan mints first (cheap), widened by trusted mints and local history.
    const candidates = Array.from(
      new Set([
        ...planSteps.flatMap((step) => [step.fromMintUrl, step.toMintUrl]),
        ...trustedMintUrls,
        ...localFallbacks,
        fromMintUrl,
        toMintUrl,
      ])
    ).slice(0, MAX_GRAPH_CANDIDATES);
    const graph = buildSwapGraph(await fetchRebalanceRouteAudits(candidates, fetchAudit));
    // Personally observed routes supplement the auditor data.
    addLocalHistoryEdges(graph, swapGroups);
    const { path } = pickIntermediaryPath({
      from: fromMintUrl,
      to: toMintUrl,
      graph,
      settings: middlemanRouting,
      trustedMintUrls: new Set(trustedMintUrls),
    });
    if (path) suggestion = { path, pathNames: path.map((url) => mintInfoMap[url]?.name || url) };
  }

  return createMiddlemanCandidateRoutes({
    fromMintUrl,
    toMintUrl,
    suggestion,
    localFallbackMintUrls: localFallbacks,
    getMintName: (mintUrl) => mintInfoMap[mintUrl]?.name || extractDomain(mintUrl),
  });
}
