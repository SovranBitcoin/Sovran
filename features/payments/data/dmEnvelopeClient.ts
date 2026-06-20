/**
 * DM envelope client. nagg is zero-knowledge: these calls return the raw
 * encrypted events (NIP-17 gift wraps kind 1059, optional NIP-04 kind 4)
 * involving the viewer; decryption happens client-side in `dmDecryptPipeline`.
 *
 * The conversation-list inbox (`fetchDmEnvelopes`) routes through the
 * tier-selecting facade (nagg DM index → raw-relay floor, gated by the Network
 * toggles). `fetchDmConversation` still hits nagg's GraphQL resolver directly.
 * Both are best-effort: an exhausted/disabled chain returns empty rather than
 * throwing, so the UI keeps working.
 */
import {
  createNaggClient,
  type NaggEventConnection,
  NaggDmConversationDataSchema,
} from '@sovranbitcoin/nagg-ts';
import { DM_CONVERSATION_QUERY, dmConversationInput } from '@sovranbitcoin/nagg-ts/recipes';
import { backendConfig } from '@/shared/config/backend';
import { paymentLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { resolvedDmEnvelopesToPage, toFacadeDmEnvelopesRequest } from './facadeDmAdapter';

const DM_TIMEOUT_MS = 12_000;

const client = createNaggClient({
  endpoint: backendConfig.nostrGraphqlEndpoint,
  // REST app-view available alongside GraphQL; defaults to GraphQL until a query opts in.
  appView: { baseUrl: backendConfig.nostrAppViewBaseUrl, version: 'v1' },
  defaultTimeoutMs: DM_TIMEOUT_MS,
});

/** Raw DM envelope event as returned by nagg (still encrypted). */
export interface DmEnvelope {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: string | number | Date;
  content: string;
  tags: string[][];
  sig?: string;
}

export interface DmEnvelopePage {
  envelopes: DmEnvelope[];
  endCursor?: string;
  hasNextPage: boolean;
}

const EMPTY_PAGE: DmEnvelopePage = { envelopes: [], hasNextPage: false };

function toPage(connection: NaggEventConnection): DmEnvelopePage {
  const endCursor =
    typeof connection.pageInfo?.endCursor === 'string' ? connection.pageInfo.endCursor : undefined;
  return {
    envelopes: connection.nodes.map((node) => ({
      id: node.id,
      pubkey: node.pubkey,
      kind: node.kind,
      createdAt: node.createdAt,
      content: node.content,
      tags: node.tags,
      sig: node.sig,
    })),
    endCursor,
    hasNextPage: connection.pageInfo?.hasNextPage ?? false,
  };
}

/**
 * All DM envelopes involving the viewer (for the conversation list).
 *
 * Routes through the tier-selecting facade: nagg DM index (the same app-view
 * `/nostr/dm/envelopes` route, paginated by wrap arrival time) → raw-relay floor
 * (kind 1059/4 by `#p`, no since/limit since gift-wrap `created_at` is
 * randomized). Which tiers run is gated by the Network settings toggles. The
 * envelopes stay opaque; decryption happens above in `dmDecryptPipeline`.
 */
export async function fetchDmEnvelopes(args: {
  viewer: string;
  kinds?: number[];
  until?: number;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<DmEnvelopePage> {
  const layer = buildNostrDataLayer();
  if (!layer) {
    paymentLog.debug('payment.dm.envelopes.no_tiers');
    return EMPTY_PAGE;
  }
  const result = await layer.getDmEnvelopes(
    toFacadeDmEnvelopesRequest({
      viewer: args.viewer,
      until: args.until,
      limit: args.limit,
      refresh: args.refresh,
      signal: args.signal,
    })
  );
  return result.match(
    (resolved) => {
      paymentLog.debug('payment.dm.envelopes.resolved', {
        tier: resolved.tier,
        envelopes: resolved.envelopes.length,
      });
      return resolvedDmEnvelopesToPage(resolved);
    },
    (error) => {
      paymentLog.debug('payment.dm.envelopes.exhausted', {
        attempts: error.attempts.map((a) => `${a.tier}=${a.outcome}`),
      });
      return EMPTY_PAGE;
    }
  );
}

/** DM envelopes for one conversation. For gift wraps the counterparty is opaque
 *  server-side, so the viewer's full wrap inbox is returned and bucketed after
 *  decryption. */
export async function fetchDmConversation(args: {
  viewer: string;
  counterparty?: string;
  kinds?: number[];
  until?: number;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<DmEnvelopePage> {
  const result = await client.query({
    query: DM_CONVERSATION_QUERY,
    operationName: 'DmConversation',
    variables: {
      input: dmConversationInput({
        viewer: args.viewer,
        counterparty: args.counterparty,
        kinds: args.kinds,
        until: args.until,
        limit: args.limit,
      }),
    },
    dataSchema: NaggDmConversationDataSchema,
    refresh: args.refresh,
    signal: args.signal,
  });
  if (result.isErr()) {
    paymentLog.debug('payment.dm.conversation.failed', { error: result.error.message });
    return EMPTY_PAGE;
  }
  return toPage(result.value.dmConversation);
}
