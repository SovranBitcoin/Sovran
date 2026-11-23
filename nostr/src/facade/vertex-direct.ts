import { z } from 'zod';
import type { SignedVertexRequest } from './vertex-request';
import { AGGREGATE_RULES, type NaggProfilesEnvelope } from '../envelope';

export const VERTEX_RELAY_URL = 'wss://relay.vertexlab.io';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface VertexSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: unknown) => void): void;
  removeEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: unknown) => void
  ): void;
}

export interface VertexRankEntry {
  pubkey: string;
  rank: number;
  follows?: number;
  followers?: number;
}

export type DirectVertexFailureReason =
  | 'insufficient_credits'
  | 'rejected'
  | 'timeout'
  | 'unavailable';

export type DirectVertexResponse =
  | {
      ok: true;
      kind: 'profile' | 'search' | 'recommend';
      entries: VertexRankEntry[];
      nodes?: number;
      fetchedAt: number;
    }
  | {
      ok: false;
      reason: DirectVertexFailureReason;
      message?: string;
    };

export interface SendDirectVertexOptions {
  relayUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  createWebSocket?: (url: string) => VertexSocketLike;
}

const NumericLikeSchema = z.union([
  z.number(),
  z.string().transform((v, ctx) => {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: 'not a finite number' });
      return z.NEVER;
    }
    return n;
  }),
]);

const VertexEntrySchema = z.looseObject({
  pubkey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  rank: NumericLikeSchema,
  follows: NumericLikeSchema.optional(),
  followers: NumericLikeSchema.optional(),
});

const VertexEntriesSchema = z.array(VertexEntrySchema);

const RelayEventSchema = z.looseObject({
  kind: z.number().int(),
  content: z.string(),
  tags: z.array(z.array(z.string())),
});

function logicalKind(requestKind: number): 'profile' | 'search' | 'recommend' {
  if (requestKind === 5312) return 'profile';
  if (requestKind === 5313) return 'recommend';
  return 'search';
}

function isInsufficientCreditsMessage(message: string): boolean {
  return /credit|balance|payment|insufficient|quota/i.test(message);
}

function extractMessageData(event: unknown): string | null {
  if (typeof event === 'string') return event;
  if (event && typeof event === 'object' && 'data' in event) {
    const data = (event as { data: unknown }).data;
    return typeof data === 'string' ? data : null;
  }
  return null;
}

/**
 * Send a signed NIP-90 Vertex DVM request (kinds 5312 / 5315 / 5313) directly
 * to `wss://relay.vertexlab.io` and await the matching response event
 * (`kind + 1000`) or DVM feedback event (`kind 7000`).
 */
export function sendDirectVertexRequest(
  signed: SignedVertexRequest,
  options: SendDirectVertexOptions = {}
): Promise<DirectVertexResponse> {
  const {
    relayUrl = VERTEX_RELAY_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    createWebSocket = (url) => new WebSocket(url) as unknown as VertexSocketLike,
  } = options;

  if (signal?.aborted) {
    return Promise.resolve({ ok: false, reason: 'timeout', message: 'aborted' });
  }

  const responseKind = signed.kind + 1000;
  const subId = `vtx-${signed.id.slice(0, 12)}`;

  return new Promise<DirectVertexResponse>((resolve) => {
    let settled = false;
    let socket: VertexSocketLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener('abort', onAbort);
      if (socket) {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
        try {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(['CLOSE', subId]));
          }
          socket.close();
        } catch {
          // Ignore close errors on already-closed sockets.
        }
        socket = null;
      }
    };

    const finish = (result: DirectVertexResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => finish({ ok: false, reason: 'timeout', message: 'aborted' });

    const onOpen = () => {
      if (settled || !socket) return;
      try {
        socket.send(
          JSON.stringify(['REQ', subId, { kinds: [responseKind, 7000], '#e': [signed.id] }])
        );
        socket.send(JSON.stringify(['EVENT', signed]));
      } catch (error) {
        finish({
          ok: false,
          reason: 'unavailable',
          message: error instanceof Error ? error.message : 'send failed',
        });
      }
    };

    const onMessage = (rawEvent: unknown) => {
      if (settled) return;
      const text = extractMessageData(rawEvent);
      if (!text) return;
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (!Array.isArray(frame) || frame.length < 2) return;

      const [type] = frame;
      if (type === 'OK' && frame[1] === signed.id && frame[2] === false) {
        const msg = typeof frame[3] === 'string' ? frame[3] : 'rejected by relay';
        finish({
          ok: false,
          reason: isInsufficientCreditsMessage(msg) ? 'insufficient_credits' : 'rejected',
          message: msg,
        });
        return;
      }

      if (type !== 'EVENT' || frame[1] !== subId) return;
      const parsedEvent = RelayEventSchema.safeParse(frame[2]);
      if (!parsedEvent.success) return;
      const ev = parsedEvent.data;
      const refsRequest = ev.tags.some((t) => t[0] === 'e' && t[1] === signed.id);
      if (!refsRequest) return;

      if (ev.kind === 7000) {
        const statusTag = ev.tags.find((t) => t[0] === 'status');
        const statusCode = statusTag?.[1] ?? '';
        const statusExtra = statusTag?.[2] ?? '';
        const message = [statusExtra, ev.content].filter(Boolean).join(': ') || statusCode;
        if (statusCode === 'processing' || statusCode === 'partial') return;
        const insufficient =
          statusCode === 'payment-required' || isInsufficientCreditsMessage(message);
        finish({
          ok: false,
          reason: insufficient ? 'insufficient_credits' : 'rejected',
          message: message || 'DVM error',
        });
        return;
      }

      if (ev.kind === responseKind) {
        let contentJson: unknown;
        try {
          contentJson = JSON.parse(ev.content);
        } catch {
          finish({ ok: false, reason: 'rejected', message: 'invalid DVM JSON content' });
          return;
        }
        const entries = VertexEntriesSchema.safeParse(contentJson);
        if (!entries.success) {
          finish({ ok: false, reason: 'rejected', message: 'invalid DVM entry shape' });
          return;
        }
        const nodesTag = ev.tags.find((t) => t[0] === 'nodes')?.[1];
        const nodes = nodesTag !== undefined ? Number(nodesTag) : undefined;
        finish({
          ok: true,
          kind: logicalKind(signed.kind),
          entries: entries.data.map((e) => ({
            pubkey: e.pubkey.toLowerCase(),
            rank: e.rank,
            follows: e.follows,
            followers: e.followers,
          })),
          nodes: nodes !== undefined && Number.isFinite(nodes) ? nodes : undefined,
          fetchedAt: Math.floor(Date.now() / 1000),
        });
      }
    };

    const onError = () => finish({ ok: false, reason: 'unavailable', message: 'websocket error' });
    const onClose = () => finish({ ok: false, reason: 'unavailable', message: 'websocket closed' });

    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () => finish({ ok: false, reason: 'timeout', message: 'vertex request timed out' }),
      timeoutMs
    );

    try {
      socket = createWebSocket(relayUrl);
      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
      if (socket.readyState === 1) onOpen();
    } catch (error) {
      finish({
        ok: false,
        reason: 'unavailable',
        message: error instanceof Error ? error.message : 'websocket init failed',
      });
    }
  });
}

/**
 * Convert a direct Vertex DVM answer into the shared `NaggProfilesEnvelope`
 * shape consumed by profile and search callers.
 */
export function directVertexToProfilesEnvelope(
  response: Extract<DirectVertexResponse, { ok: true }>,
  targetPubkey?: string
): NaggProfilesEnvelope {
  const pubkeys: string[] = [];
  const providers: NonNullable<NaggProfilesEnvelope['providers']> = {};
  const aggregates: NaggProfilesEnvelope['aggregates'] = {};

  const normalizedTarget = targetPubkey?.toLowerCase();
  const seen = new Set<string>();

  for (const [index, entry] of response.entries.entries()) {
    if (!seen.has(entry.pubkey)) {
      seen.add(entry.pubkey);
      pubkeys.push(entry.pubkey);
    }
    providers[entry.pubkey] = {
      vertex: {
        score: entry.rank,
        rank: index + 1,
        fetchedAt: response.fetchedAt,
      },
    };
    if (entry.followers !== undefined || entry.follows !== undefined) {
      const bucket: Record<string, Record<string, number>> = {};
      if (entry.followers !== undefined) {
        bucket[AGGREGATE_RULES.followers.rule] = {
          [AGGREGATE_RULES.followers.metric]: Math.round(entry.followers),
        };
      }
      if (entry.follows !== undefined) {
        bucket[AGGREGATE_RULES.following.rule] = {
          [AGGREGATE_RULES.following.metric]: Math.round(entry.follows),
        };
      }
      aggregates[entry.pubkey] = bucket;
    }
  }

  // Ensure the target pubkey is always first for profile responses.
  if (response.kind === 'profile' && normalizedTarget && !seen.has(normalizedTarget)) {
    pubkeys.unshift(normalizedTarget);
  }

  return {
    events: [],
    order: [],
    orderBy: 'rank',
    identities: {},
    pubkeys,
    providers,
    aggregates,
    vertexFresh: true,
  };
}
