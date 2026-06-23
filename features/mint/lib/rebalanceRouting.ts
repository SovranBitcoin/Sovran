/**
 * Reroute suggestion for a failed rebalance leg.
 *
 * Pure orchestration over the rebalance graph helpers: given the mints already
 * in play plus local swap history, gather a bounded candidate set, build the
 * trust/route graph (auditor data + personally-observed edges), and pick an
 * intermediary path. The auditor lookup is an injected port (`fetchAudit`) so
 * this is testable without network or store access — it runs on the
 * failure-recovery path, not the live melt-execution path.
 */
import type { GetInfoResponse } from '@cashu/cashu-ts';

import {
  addLocalHistoryEdges,
  buildSwapGraph,
  getLocalCandidatesForDestination,
  pickIntermediaryPath,
} from '@/features/mint/components/rebalance';
import type { AuditMintResponse } from '@/shared/lib/apiClient';
import type { MiddlemanRoutingSettings } from '@/shared/stores/global/settingsStore';
import type { SwapGroup } from '@/shared/stores/profile/swapTransactionsStore';

/** Cap on candidate mints probed per suggestion — each can cost an auditor call,
 *  and this runs after a failure where a quick answer beats a full graph crawl. */
const MAX_ROUTE_CANDIDATES = 12;

export interface RouteSuggestionInput {
  fromMintUrl: string;
  toMintUrl: string;
  /** Mints already referenced by the run plan's steps (from + to of each). */
  planMintUrls: string[];
  trustedMintUrls: string[];
  mintInfoMap: Record<string, GetInfoResponse | null>;
  middlemanRouting: MiddlemanRoutingSettings;
  /** All local swap-history groups (Object.values of the store's groups). */
  groups: SwapGroup[];
  /** Injected auditor lookup; returns null when a mint can't be audited. */
  fetchAudit: (mintUrl: string) => Promise<AuditMintResponse | null>;
}

export interface RouteSuggestion {
  path: string[];
  pathNames: string[];
}

export async function computeRouteSuggestion(
  input: RouteSuggestionInput
): Promise<RouteSuggestion | null> {
  const { fromMintUrl, toMintUrl, planMintUrls, trustedMintUrls, mintInfoMap, middlemanRouting } =
    input;

  // Also include mints from local swap history that have reached the destination.
  const localCandidateMints = getLocalCandidatesForDestination(
    input.groups,
    toMintUrl,
    fromMintUrl
  );

  const candidates = Array.from(
    new Set([...planMintUrls, ...trustedMintUrls, ...localCandidateMints, fromMintUrl, toMintUrl])
  ).slice(0, MAX_ROUTE_CANDIDATES);

  const audits: AuditMintResponse[] = [];
  for (const url of candidates) {
    const a = await input.fetchAudit(url);
    if (a) audits.push(a);
  }

  const graph = buildSwapGraph(audits);

  // Merge our own local swap history into the graph so personally observed
  // routes (e.g. "minibits → sovran worked last week") supplement auditor data.
  addLocalHistoryEdges(graph, input.groups);

  const result = pickIntermediaryPath({
    from: fromMintUrl,
    to: toMintUrl,
    graph,
    settings: middlemanRouting,
    trustedMintUrls: new Set(trustedMintUrls),
  });
  if (!result.path) return null;

  const pathNames = result.path.map((url) => mintInfoMap[url]?.name || url);
  return { path: result.path, pathNames };
}
