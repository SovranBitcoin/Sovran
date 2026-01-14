import type { AuditMintResponse } from 'helper/apiClient';

/**
 * Auditor-based routing helper for Lightning "no_route" failures.
 *
 * The auditor API provides historical swap outcomes between mints. We build a directed graph of
 * observed successful swaps, then pick an intermediary `via` mint if we can find A→via and via→B.
 *
 * This is intentionally heuristic:
 * - It’s a best-effort suggestion (not a guarantee of a route).
 * - We keep it cheap to compute because it runs after a failed payment.
 */

type EdgeStats = {
  count: number;
  lastTs: number;
  avgFee: number;
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
  // Be permissive: the auditor may use different labels across versions.
  if (state === 'failed' || state === 'error') return false;
  // If there's no error and state isn't explicitly failed, treat as success.
  return true;
}

function addEdge(
  graph: SwapGraph,
  from: string,
  to: string,
  fee: number,
  timeTaken: number,
  ts: number
) {
  if (!from || !to) return;
  if (from === to) return;
  const out = graph.get(from) ?? new Map<string, EdgeStats>();
  const prev = out.get(to);

  const nextCount = (prev?.count ?? 0) + 1;
  const nextAvgFee = prev ? (prev.avgFee * prev.count + fee) / nextCount : fee;
  const nextAvgTime = prev ? (prev.avgTimeTaken * prev.count + timeTaken) / nextCount : timeTaken;
  const nextLastTs = Math.max(prev?.lastTs ?? 0, ts);

  out.set(to, {
    count: nextCount,
    lastTs: nextLastTs,
    avgFee: nextAvgFee,
    avgTimeTaken: nextAvgTime,
  });
  graph.set(from, out);
}

export function buildSwapGraph(audits: AuditMintResponse[]): SwapGraph {
  const graph: SwapGraph = new Map();

  for (const audit of audits) {
    for (const swap of audit?.swaps ?? []) {
      if (!isSuccessfulSwap(swap)) continue;
      const from = swap.from_url;
      const to = swap.to_url;
      addEdge(graph, from, to, swap.fee ?? 0, swap.time_taken ?? 0, parseTs(swap.created_at));
    }
  }

  return graph;
}

export function pickIntermediary({
  from,
  to,
  graph,
}: {
  from: string;
  to: string;
  graph: SwapGraph;
}): { viaMintUrl: string | null; reason: string } {
  const aOut = graph.get(from);
  if (!aOut) {
    return { viaMintUrl: null, reason: 'No successful routes from source mint in auditor data.' };
  }

  let bestVia: string | null = null;
  let bestScore = -Infinity;

  for (const [via, edge1] of aOut.entries()) {
    if (!via || via === from || via === to) continue;
    const viaOut = graph.get(via);
    const edge2 = viaOut?.get(to);
    if (!edge2) continue;

    // Score:
    // - prefer higher observed success count for both legs
    // - prefer more recent successes
    // - prefer lower fees and lower time taken
    // NOTE: Recency is only used for relative ranking, not as an absolute “freshness” threshold.
    const countScore = (edge1.count + edge2.count) * 10;
    const recencyScore = (edge1.lastTs + edge2.lastTs) / (1000 * 60 * 60); // hours since epoch; relative comparisons only
    const feePenalty = (edge1.avgFee + edge2.avgFee) * 5;
    const timePenalty = (edge1.avgTimeTaken + edge2.avgTimeTaken) * 0.2;

    const score = countScore + recencyScore - feePenalty - timePenalty;

    if (score > bestScore) {
      bestScore = score;
      bestVia = via;
    }
  }

  if (!bestVia) {
    return {
      viaMintUrl: null,
      reason: 'No intermediary route found (A→via and via→B) in auditor data.',
    };
  }

  return {
    viaMintUrl: bestVia,
    reason: 'Found a recently successful intermediary route via auditor history.',
  };
}
