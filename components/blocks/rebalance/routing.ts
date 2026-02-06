import type { AuditMintResponse } from 'helper/apiClient';
import type { MiddlemanRoutingSettings } from 'stores/settingsStore';

/**
 * Auditor-based routing helper for Lightning "no_route" failures.
 *
 * The auditor API provides historical swap outcomes between mints. We build a directed graph of
 * observed swaps (both successful and failed), then pick intermediary mint(s) that satisfy the
 * user's quality settings (success rate, max fee, last swap OK, max hops).
 *
 * This is intentionally heuristic:
 * - It's a best-effort suggestion (not a guarantee of a route).
 * - We keep it cheap to compute because it runs after a failed payment.
 */

export type EdgeStats = {
  /** Number of successful swaps on this edge. */
  okCount: number;
  /** Total number of swaps on this edge (including failures). */
  totalCount: number;
  /** Timestamp (ms since epoch) of the most recent swap. */
  lastTs: number;
  /** Whether the most recent swap was OK. */
  lastOk: boolean;
  /** Average fee of successful swaps (sats). */
  avgFee: number;
  /** Average time taken of successful swaps (ms). */
  avgTimeTaken: number;
};

export type SwapGraph = Map<string, Map<string, EdgeStats>>;

function parseTs(createdAt: string): number {
  const ts = Date.parse(createdAt);
  return Number.isFinite(ts) ? ts : 0;
}

function isSuccessfulSwap(swap: AuditMintResponse['swaps'][number]): boolean {
  if (!swap) return false;
  if (swap.error) return false;
  const state = (swap.state || '').toLowerCase();
  if (state === 'failed' || state === 'error') return false;
  return true;
}

function addEdge(
  graph: SwapGraph,
  from: string,
  to: string,
  fee: number,
  timeTaken: number,
  ts: number,
  ok: boolean
) {
  if (!from || !to) return;
  if (from === to) return;
  const out = graph.get(from) ?? new Map<string, EdgeStats>();
  const prev = out.get(to);

  const nextTotalCount = (prev?.totalCount ?? 0) + 1;
  const nextOkCount = (prev?.okCount ?? 0) + (ok ? 1 : 0);

  // Average fee/time only over successful swaps
  let nextAvgFee = prev?.avgFee ?? 0;
  let nextAvgTime = prev?.avgTimeTaken ?? 0;
  if (ok) {
    const prevOk = prev?.okCount ?? 0;
    nextAvgFee = prevOk > 0 ? (prev!.avgFee * prevOk + fee) / nextOkCount : fee;
    nextAvgTime = prevOk > 0 ? (prev!.avgTimeTaken * prevOk + timeTaken) / nextOkCount : timeTaken;
  }

  // Track the most recent swap's state
  const isNewest = ts >= (prev?.lastTs ?? 0);
  const nextLastTs = Math.max(prev?.lastTs ?? 0, ts);
  const nextLastOk = isNewest ? ok : (prev?.lastOk ?? ok);

  out.set(to, {
    okCount: nextOkCount,
    totalCount: nextTotalCount,
    lastTs: nextLastTs,
    lastOk: nextLastOk,
    avgFee: nextAvgFee,
    avgTimeTaken: nextAvgTime,
  });
  graph.set(from, out);
}

/**
 * Build a directed graph from auditor swap history.
 * Includes ALL swaps (successful and failed) so we can compute success rates.
 */
export function buildSwapGraph(audits: AuditMintResponse[]): SwapGraph {
  const graph: SwapGraph = new Map();

  for (const audit of audits) {
    for (const swap of audit?.swaps ?? []) {
      if (!swap) continue;
      const from = swap.from_url;
      const to = swap.to_url;
      const ok = isSuccessfulSwap(swap);
      addEdge(graph, from, to, swap.fee ?? 0, swap.time_taken ?? 0, parseTs(swap.created_at), ok);
    }
  }

  return graph;
}

/** Default routing settings (used when none are provided). */
const DEFAULT_SETTINGS: MiddlemanRoutingSettings = {
  maxHops: 1,
  maxFee: 5,
  minSuccessRate: 0.9,
  requireLastOk: true,
  trustMode: 'trusted_only',
};

/** Check if an edge passes the quality filters. */
function edgePassesFilters(edge: EdgeStats, settings: MiddlemanRoutingSettings): boolean {
  // Success rate check
  if (edge.totalCount > 0) {
    const successRate = edge.okCount / edge.totalCount;
    if (successRate < settings.minSuccessRate) return false;
  } else {
    // No data at all — skip this edge
    return false;
  }

  // Last swap must be OK
  if (settings.requireLastOk && !edge.lastOk) return false;

  return true;
}

/**
 * Score a complete path for ranking among candidates.
 * Higher is better.
 *
 * @param trustedBonus — bonus added per trusted intermediary node in the path.
 *   Used in `allow_untrusted` mode so trusted mints are always preferred.
 */
function scorePath(edges: EdgeStats[], trustedBonus = 0): number {
  let totalScore = trustedBonus;
  for (const edge of edges) {
    const countScore = edge.okCount * 10;
    const recencyScore = edge.lastTs / (1000 * 60 * 60);
    const feePenalty = edge.avgFee * 5;
    const timePenalty = edge.avgTimeTaken * 0.2;
    totalScore += countScore + recencyScore - feePenalty - timePenalty;
  }
  return totalScore;
}

export interface RoutingResult {
  /** Ordered path of mint URLs from source to destination (inclusive). */
  path: string[] | null;
  reason: string;
}

/** Large bonus added per trusted intermediary to ensure trusted paths win over untrusted ones. */
const TRUSTED_BONUS_PER_HOP = 100_000;

/**
 * Find the best intermediary path from `from` to `to` through up to `maxHops` intermediaries.
 *
 * Uses BFS with quality filtering:
 * - Each edge must pass success rate, last-OK, and fee filters.
 * - Total fee across all hops must not exceed `maxFee`.
 * - In `trusted_only` mode, intermediary nodes must be in `trustedMintUrls`.
 * - In `allow_untrusted` mode, trusted intermediaries receive a large scoring bonus
 *   so they are always preferred when available.
 * - Among all valid paths, pick the one with the highest score.
 */
export function pickIntermediaryPath({
  from,
  to,
  graph,
  settings,
  trustedMintUrls,
}: {
  from: string;
  to: string;
  graph: SwapGraph;
  settings?: Partial<MiddlemanRoutingSettings>;
  /** Set of mint URLs the user trusts. Used for trust-mode filtering. */
  trustedMintUrls?: Set<string>;
}): RoutingResult {
  const cfg: MiddlemanRoutingSettings = { ...DEFAULT_SETTINGS, ...settings };
  const maxDepth = cfg.maxHops + 1; // maxHops intermediaries = maxHops+1 edges
  const trusted = trustedMintUrls ?? new Set<string>();

  const aOut = graph.get(from);
  if (!aOut) {
    return { path: null, reason: 'No swap data from source mint in auditor history.' };
  }

  // BFS: each entry is { currentNode, path (nodes visited), edges (EdgeStats along path), totalFee }
  type BFSEntry = {
    node: string;
    path: string[];
    edges: EdgeStats[];
    totalFee: number;
  };

  const queue: BFSEntry[] = [{ node: from, path: [from], edges: [], totalFee: 0 }];
  let bestPath: string[] | null = null;
  let bestScore = -Infinity;

  while (queue.length > 0) {
    const entry = queue.shift()!;

    // Don't explore deeper than maxDepth edges
    if (entry.edges.length >= maxDepth) continue;

    const neighbors = graph.get(entry.node);
    if (!neighbors) continue;

    for (const [neighbor, edge] of neighbors.entries()) {
      if (!neighbor) continue;
      // Don't revisit nodes (avoid cycles); only `to` may appear as the terminal node
      if (entry.path.includes(neighbor) && neighbor !== to) continue;

      // Trust check for intermediary nodes (not the final destination)
      if (neighbor !== to) {
        if (cfg.trustMode === 'trusted_only' && !trusted.has(neighbor)) continue;
      }

      // Check edge quality
      if (!edgePassesFilters(edge, cfg)) continue;

      // Check cumulative fee
      const newFee = entry.totalFee + edge.avgFee;
      if (newFee > cfg.maxFee) continue;

      const newPath = [...entry.path, neighbor];
      const newEdges = [...entry.edges, edge];

      if (neighbor === to) {
        // Count how many intermediary nodes in this path are trusted (bonus for scoring)
        const intermediaries = newPath.slice(1, -1);
        const trustedCount = intermediaries.filter((url) => trusted.has(url)).length;
        const trustedBonus = trustedCount * TRUSTED_BONUS_PER_HOP;

        const score = scorePath(newEdges, trustedBonus);
        if (score > bestScore) {
          bestScore = score;
          bestPath = newPath;
        }
      } else if (newEdges.length < maxDepth) {
        // Continue exploring
        queue.push({
          node: neighbor,
          path: newPath,
          edges: newEdges,
          totalFee: newFee,
        });
      }
    }
  }

  if (!bestPath) {
    const modeHint =
      cfg.trustMode === 'trusted_only'
        ? ' Only trusted mints were considered. Try "Allow untrusted" in Swap Routing settings.'
        : '';
    return {
      path: null,
      reason: `No intermediary route found within ${cfg.maxHops} hop(s), ${cfg.maxFee} sat fee limit, and ${Math.round(cfg.minSuccessRate * 100)}% success rate.${modeHint}`,
    };
  }

  // Check if any intermediaries are untrusted (for UI signaling)
  const intermediaries = bestPath.slice(1, -1);
  const untrustedCount = intermediaries.filter((url) => !trusted.has(url)).length;
  const trustNote =
    untrustedCount > 0
      ? ` (${untrustedCount} untrusted mint(s) will be temporarily trusted for the swap)`
      : '';

  return {
    path: bestPath,
    reason: `Found route via ${bestPath.length - 2} intermediary mint(s) in auditor history.${trustNote}`,
  };
}
