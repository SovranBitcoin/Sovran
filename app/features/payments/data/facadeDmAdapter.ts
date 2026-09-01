/**
 * Pure adapters between the app's DM envelope shape and the nagg-ts facade's
 * `getDmEnvelopes` index surface. No I/O, no app singletons — just mapping, so
 * the conversation-list wiring stays testable and the facade caveat (it only
 * resolves at runtime in local/symlinked nagg-ts) lives in one transport file.
 *
 * The facade is an INDEX only: it returns the opaque encrypted envelopes (kind
 * 1059 gift wraps + kind 4 legacy) that reference the viewer. Decryption,
 * sender identification, and bucketing stay client-side in `dmDecryptPipeline`.
 */
import type { facade } from 'nostr';

import type { DmEnvelope, DmEnvelopePage } from './dmEnvelopeTypes';

/** Translate the app's `until` (wrap arrival seconds) into the facade's cursor.
 *  Only the nagg tier honours it; the relay floor fetches the whole inbox. */
export function toFacadeDmEnvelopesRequest(args: {
  viewer: string;
  until?: number;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}): facade.DmEnvelopesRequest {
  return {
    viewerPubkey: args.viewer,
    ...(typeof args.until === 'number' ? { cursor: { createdAt: args.until, id: '' } } : {}),
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(args.refresh ? { refresh: true } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
  };
}

/** Map a resolved tier answer back to the app's `DmEnvelopePage`. The app
 *  re-derives its `until` cursor from envelope `createdAt` (see `dmPagination`),
 *  so `hasNextPage` is simply "this page had envelopes" — an empty answer (every
 *  tier drained/disabled) stops `loadMore` rather than looping. */
export function resolvedDmEnvelopesToPage(resolved: facade.ResolvedDmEnvelopes): DmEnvelopePage {
  const envelopes: DmEnvelope[] = resolved.envelopes.map((e) => ({
    id: e.id,
    pubkey: e.pubkey,
    kind: e.kind,
    createdAt: e.createdAt,
    content: e.content,
    tags: e.tags,
    ...(e.sig ? { sig: e.sig } : {}),
  }));
  return { envelopes, hasNextPage: envelopes.length > 0 };
}
