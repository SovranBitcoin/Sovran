/**
 * GraphQL client for DM envelopes. nagg is zero-knowledge: these calls return
 * the raw encrypted events (NIP-17 gift wraps kind 1059, optional NIP-04 kind 4)
 * involving the viewer; decryption happens client-side in `dmDecryptPipeline`.
 *
 * Best-effort: the resolvers ship with the nagg deploy, so until then every
 * call returns empty rather than throwing — callers keep working on the
 * existing relay path.
 */
import {
  createNaggClient,
  type NaggEventConnection,
  NaggDmConversationDataSchema,
  NaggDmEnvelopesDataSchema,
} from '@sovranbitcoin/nagg-ts';
import {
  DM_CONVERSATION_QUERY,
  DM_ENVELOPES_QUERY,
  dmConversationInput,
  dmEnvelopesAppView,
  dmEnvelopesInput,
} from '@sovranbitcoin/nagg-ts/recipes';
import { backendConfig } from '@/shared/config/backend';
import { paymentLog } from '@/shared/lib/logger';

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

/** All DM envelopes involving the viewer (for the conversation list). */
export async function fetchDmEnvelopes(args: {
  viewer: string;
  kinds?: number[];
  until?: number;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<DmEnvelopePage> {
  const recipeInput = {
    viewer: args.viewer,
    kinds: args.kinds,
    until: args.until,
    limit: args.limit,
  };
  const result = await client.query({
    query: DM_ENVELOPES_QUERY,
    operationName: 'DmEnvelopes',
    variables: { input: dmEnvelopesInput(recipeInput) },
    dataSchema: NaggDmEnvelopesDataSchema,
    // Dedicated REST app-view for the contacts/DM list when enabled; otherwise
    // the GraphQL resolver. Both transports parse the same `{ dmEnvelopes: {
    // nodes, pageInfo } }` connection via `NaggDmEnvelopesDataSchema` — no
    // per-transport normalize layer (the REST body is already canonical).
    transport: backendConfig.nostrDmAppView ? 'appview' : 'graphql',
    appView: dmEnvelopesAppView(recipeInput),
    refresh: args.refresh,
    signal: args.signal,
  });
  if (result.isErr()) {
    paymentLog.debug('payment.dm.envelopes.failed', { error: result.error.message });
    return EMPTY_PAGE;
  }
  return toPage(result.value.dmEnvelopes);
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
