/**
 * DM envelope client. nagg is zero-knowledge: these calls return the raw
 * encrypted events (NIP-17 gift wraps kind 1059, optional NIP-04 kind 4)
 * involving the viewer; decryption happens client-side in `dmDecryptPipeline`.
 *
 * The conversation-list inbox (`fetchDmEnvelopes`) routes through the
 * tier-selecting facade (nagg DM index → raw-relay floor, gated by the Network
 * toggles). `fetchDmConversation` hits nagg's REST app-view
 * (`GET /nostr/dm/conversation`) directly. Both are best-effort: an exhausted/
 * disabled chain returns empty rather than throwing, so the UI keeps working.
 */
import {
  createNaggClient,
  NaggEnvelopeSchema,
  orderedEnvelopeEvents,
  type NaggEnvelope,
} from 'nostr';
import { dmConversationAppView } from 'nostr/recipes';
import { backendConfig } from '@/shared/config/backend';
import type { DmEnvelope, DmEnvelopePage } from './dmEnvelopeTypes';
import { paymentLog } from '@/shared/lib/logger';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { resolvedDmEnvelopesToPage, toFacadeDmEnvelopesRequest } from './facadeDmAdapter';

const DM_TIMEOUT_MS = 12_000;

const client = createNaggClient({
  appView: { baseUrl: backendConfig.nostrAppViewBaseUrl, version: 'v1' },
  defaultTimeoutMs: DM_TIMEOUT_MS,
});

/** Raw DM envelope event as returned by nagg (still encrypted). */
const EMPTY_PAGE: DmEnvelopePage = { envelopes: [], hasNextPage: false };

/**
 * Bridge a v2 envelope into the app's DM page. By design the DM routes carry
 * NO aggregates and NO profile hydration (privacy) — only the raw encrypted
 * wraps, arrival-ordered. Paging is length-based here (the callers re-derive
 * their `until` cursor from envelope `createdAt`), matching the facade path.
 */
function toPage(envelope: NaggEnvelope): DmEnvelopePage {
  const events = envelope.order.length > 0 ? orderedEnvelopeEvents(envelope) : envelope.events;
  const envelopes: DmEnvelope[] = events.map((event) => {
    const sig = (event as { sig?: unknown }).sig;
    return {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      createdAt: event.created_at,
      content: event.content,
      tags: event.tags,
      ...(typeof sig === 'string' && sig ? { sig } : {}),
    };
  });
  return { envelopes, hasNextPage: envelopes.length > 0 };
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
      const page = resolvedDmEnvelopesToPage(resolved);
      // Dev-only: stamp each envelope with its serving tier so the contacts
      // list can badge each conversation's source (n/c/r) — the decrypted
      // message keeps the wrap's event id, which is the badge key.
      if (__DEV__) {
        recordDebugTiers(
          page.envelopes.map((envelope) => envelope.id),
          resolved.tier
        );
      }
      return page;
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
  const binding = dmConversationAppView({
    viewer: args.viewer,
    counterparty: args.counterparty,
    kinds: args.kinds,
    until: args.until,
    limit: args.limit,
  });
  const result = await client.rest({
    path: binding.path,
    method: binding.method,
    searchParams: binding.searchParams,
    responseSchema: NaggEnvelopeSchema,
    operationName: binding.operationName,
    refresh: args.refresh,
    signal: args.signal,
  });
  if (result.isErr()) {
    paymentLog.debug('payment.dm.conversation.failed', { error: result.error.message });
    return EMPTY_PAGE;
  }
  return toPage(result.value);
}
