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

export type DmConversationInput = {
  viewer: string;
  counterparty?: string;
  kinds?: number[];
  until?: number;
  limit?: number;
};

const DM_EVENT_SELECTION = `
    nodes {
      id
      pubkey
      kind
      createdAt
      content
      tags
      sig
    }
    pageInfo {
      hasNextPage
      endCursor
    }`;

export const DM_ENVELOPES_QUERY = `
query DmEnvelopes($input: DmEnvelopesInput!) {
  dmEnvelopes(input: $input) {${DM_EVENT_SELECTION}
  }
}
`;

export const DM_CONVERSATION_QUERY = `
query DmConversation($input: DmConversationInput!) {
  dmConversation(input: $input) {${DM_EVENT_SELECTION}
  }
}
`;

export function dmEnvelopesInput(options: DmEnvelopesInput): DmEnvelopesInput {
  return {
    viewer: options.viewer,
    kinds: options.kinds ?? [4, 1059],
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 50,
  };
}

export function dmConversationInput(options: DmConversationInput): DmConversationInput {
  return {
    viewer: options.viewer,
    ...(options.counterparty ? { counterparty: options.counterparty } : {}),
    kinds: options.kinds ?? [4, 1059],
    ...(options.until ? { until: options.until } : {}),
    limit: options.limit ?? 50,
  };
}

/**
 * App-view binding for {@link DM_ENVELOPES_QUERY}: routes a `transport:'appview'`
 * request to the dedicated REST endpoint `GET /nostr/dm/envelopes` and normalizes
 * its `{ envelopes, hasNextPage }` body back into the same GraphQL connection
 * shape (`{ dmEnvelopes: { nodes, pageInfo } }`) the `dataSchema` validates — so
 * the caller gets an identical result whichever transport runs.
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
    normalize: normalizeDmEnvelopesRest,
  };
}

function normalizeDmEnvelopesRest(raw: unknown): unknown {
  const body = (raw ?? {}) as { envelopes?: unknown[]; hasNextPage?: boolean };
  const nodes = Array.isArray(body.envelopes)
    ? body.envelopes.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        return {
          id: e.id,
          pubkey: e.pubkey,
          kind: e.kind,
          createdAt: e.createdAt,
          content: e.content,
          tags: e.tags,
          sig: e.sig,
        };
      })
    : [];
  return {
    dmEnvelopes: {
      nodes,
      pageInfo: { hasNextPage: body.hasNextPage ?? false, endCursor: null },
    },
  };
}
