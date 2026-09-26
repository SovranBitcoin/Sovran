import type { LineupEntry } from '@/shared/lib/routstr/lineup';
import { aiLog } from '@/shared/lib/logger';

/**
 * Which models a node has recently failed to serve, remembered for the session.
 *
 * A node's catalog is a claim about its upstreams, and the claim goes stale:
 * on 2026-09-26 `privateprovider.xyz` listed `tinfoil-deepseek-v4-flash` and
 * answered every request for it with the enclave's 404, while its sibling
 * `tinfoil-deepseek-v4-1-flash` worked on the same node minutes apart. The user
 * paid three times to learn the same thing, because nothing remembered it: each
 * send re-resolved the tier to the same cheapest model, and the catalog that
 * had lied about it once was still the catalog.
 *
 * This is that memory. It is keyed by node AND model, because a model missing
 * at one node's upstream is served fine by the next node's; it is in memory
 * only, because a node's upstream comes back and a persisted verdict would
 * outlive the outage; and it expires, for the same reason.
 *
 * It never removes a candidate. It reorders: a model marked here moves behind
 * the rest of its chain so the send tries what has not failed first, and is
 * still tried last if nothing else works. A user who has picked exactly one
 * model still gets it, just after the alternatives.
 */

interface Unavailability {
  at: number;
  status: number;
  code?: string;
}

/** How long a refusal counts against a model. Long enough to cover a retry
 *  burst, short enough that a node repairing its upstream is found again
 *  within the same sitting. */
export const MODEL_UNAVAILABLE_TTL_MS = 30 * 60 * 1000;

const unavailable = new Map<string, Unavailability>();

const key = (nodeBaseUrl: string, modelId: string) => `${nodeBaseUrl}|${modelId}`;

export function markModelUnavailable(
  nodeBaseUrl: string | null | undefined,
  modelId: string,
  refusal: { status: number; code?: string },
  now: number = Date.now()
): void {
  if (!nodeBaseUrl) return;
  unavailable.set(key(nodeBaseUrl, modelId), { at: now, ...refusal });
  aiLog.info('ai.model.marked_unavailable', {
    nodeBaseUrl,
    modelId,
    status: refusal.status,
    code: refusal.code,
    ttlMs: MODEL_UNAVAILABLE_TTL_MS,
  });
}

export function isModelUnavailable(
  nodeBaseUrl: string | null | undefined,
  modelId: string,
  now: number = Date.now()
): boolean {
  if (!nodeBaseUrl) return false;
  const entry = unavailable.get(key(nodeBaseUrl, modelId));
  if (!entry) return false;
  if (now - entry.at > MODEL_UNAVAILABLE_TTL_MS) {
    unavailable.delete(key(nodeBaseUrl, modelId));
    return false;
  }
  return true;
}

/**
 * The chain with recently-refused models moved to the back, in their original
 * relative order. Same array back when nothing moved, so callers can tell.
 */
export function orderByAvailability<T extends Pick<LineupEntry, 'modelId'>>(
  nodeBaseUrl: string | null | undefined,
  entries: readonly T[],
  now: number = Date.now()
): T[] {
  const served: T[] = [];
  const refused: T[] = [];
  for (const entry of entries) {
    (isModelUnavailable(nodeBaseUrl, entry.modelId, now) ? refused : served).push(entry);
  }
  return refused.length === 0 ? [...entries] : [...served, ...refused];
}

/** Test seam. */
export function resetModelAvailability(): void {
  unavailable.clear();
}
