/**
 * @fileoverview Pending-request consolidation — one prompt per identical spam
 *
 * Clients retry requests with fresh rpc ids (settings reads re-fired on every
 * navigation) and conversation loads fire dozens of same-peer decrypts. The
 * approval surfaces group these so ONE decision covers the whole burst:
 *   - decrypt groups by (client, method, PEER) — ciphertext deliberately
 *     excluded; the user's decision is "read my conversation with X", the
 *     same scope as the per-peer duration grants.
 *   - sign_event groups by (client, kind, content, tags) ignoring created_at
 *     and rpc id — the retry shape.
 *   - encrypt groups only on identical plaintext.
 *   - 'none' previews never group.
 *
 * SECURITY: the verdict applies to EVERY member of a group, so the payload
 * hash is load-bearing — a collision would approve a request the user never
 * saw. SHA-256, not a display hash; a malicious client must not be able to
 * smuggle a second payload under an approved key.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { Nip46PendingRequest } from '@/features/nostrSigner/data/nip46RequestsStore';
import type { Nip46DecisionAction } from '@/features/nostrSigner/lib/nip46Engine';

function stableHash(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

/** Stable identity for "the same request, re-sent". */
export function requestGroupKey(request: Nip46PendingRequest): string {
  const preview = request.paramsPreview;
  switch (preview.type) {
    case 'decrypt':
      return `${request.clientPubkey}|decrypt|${request.method}|${preview.peerPubkey.toLowerCase()}`;
    case 'sign_event':
      return `${request.clientPubkey}|sign|${request.kind ?? '?'}|${stableHash(
        preview.event.content
      )}|${stableHash(JSON.stringify(preview.event.tags))}`;
    case 'encrypt':
      return `${request.clientPubkey}|encrypt|${request.method}|${preview.peerPubkey.toLowerCase()}|${stableHash(
        preview.plaintext
      )}`;
    case 'none':
      return `id:${request.id}`;
  }
}

export interface Nip46RequestGroup {
  key: string;
  /** Queue order within the group; `requests[0]` is the presentation source. */
  requests: Nip46PendingRequest[];
}

/**
 * Group the pending queue by `requestGroupKey`, anchored at each key's FIRST
 * occurrence (spam interleaves across apps — consecutive-only would
 * under-merge). Group order and within-group order both preserve queue order,
 * so `promote(id)` still controls which group renders as the head.
 */
export function consolidatePending(pending: readonly Nip46PendingRequest[]): Nip46RequestGroup[] {
  const byKey = new Map<string, Nip46RequestGroup>();
  const ordered: Nip46RequestGroup[] = [];
  for (const request of pending) {
    const key = requestGroupKey(request);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      existing.requests.push(request);
      continue;
    }
    const group: Nip46RequestGroup = { key, requests: [request] };
    byKey.set(key, group);
    ordered.push(group);
  }
  return ordered;
}

/**
 * The request ids a verdict must resolve for a group. `'block'` resolves the
 * head only — the engine's block path flushes the app's remaining pending
 * requests itself; looping would race it into unknown-request errors.
 */
export function verdictIdsForGroup(
  action: Nip46DecisionAction,
  group: Nip46RequestGroup
): string[] {
  if (action === 'block') {
    const head = group.requests[0];
    return head !== undefined ? [head.id] : [];
  }
  return group.requests.map((request) => request.id);
}

/**
 * Whether a departed head group left because the user resolved it or because
 * it expired under them: 'expired' iff NONE of its ids were resolved.
 */
export function groupDeparted(
  prevIds: readonly string[],
  resolvedIds: ReadonlySet<string>
): 'resolved' | 'expired' {
  return prevIds.some((id) => resolvedIds.has(id)) ? 'resolved' : 'expired';
}
