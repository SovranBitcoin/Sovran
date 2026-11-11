// DM envelope recipes. nagg is zero-knowledge: these queries return the raw
// encrypted envelopes (NIP-04 kind 4 and NIP-17 gift wraps kind 1059) involving
// the viewer. The client decrypts and buckets them by counterparty.

import type { NaggAppViewBinding } from '../transport';

export type DmEnvelopesInput = {
  viewer: string;
  kinds?: number[];
  until?: number;
  limit?: number;
};

/**
 * App-view binding for the DM index: `GET /nostr/dm/envelopes`. v2 answers with
 * the generic envelope, and BY DESIGN it carries no aggregates and no profile
 * hydration (privacy) — only the raw encrypted wraps. Parse with
 * `NaggEnvelopeSchema` and bridge via `bundleFromDmEnvelope`.
 */
export function dmEnvelopesAppView(options: DmEnvelopesInput): NaggAppViewBinding {
  const kinds = options.kinds ?? [4, 1059];
  return {
    path: '/nostr/dm/envelopes',
    method: 'GET',
    operationName: 'DmEnvelopes',
    searchParams: {
      viewer: options.viewer,
      kinds: kinds.join(','),
      ...(options.until ? { until: options.until } : {}),
      limit: options.limit ?? 50,
    },
  };
}
