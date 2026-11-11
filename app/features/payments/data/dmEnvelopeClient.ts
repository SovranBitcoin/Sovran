/**
 * Shared opaque DM inbox for Contacts and conversation history. Decryption and
 * peer filtering stay on-device.
 *
 * The facade is an INDEX only: it returns the opaque encrypted envelopes (kind
 * 1059 gift wraps + kind 4 legacy) that reference the viewer. Decryption,
 * sender identification, and bucketing stay client-side in `dmDecryptPipeline`.
 */
import type { facade } from 'nostr';

import type { DmEnvelope, DmEnvelopePage } from './dmEnvelopeTypes';
import { paymentLog } from '@/shared/lib/logger';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

const EMPTY_PAGE: DmEnvelopePage = { envelopes: [], hasNextPage: false };

/** Map a resolved tier answer to the app's `DmEnvelopePage`. The app
 *  re-derives its `until` cursor from envelope `createdAt` (see `dmPagination`),
 *  so `hasNextPage` is simply "this page had envelopes" — an empty answer (every
 *  tier drained/disabled) stops `loadMore` rather than looping. */
function toDmEnvelopePage(resolved: facade.ResolvedDmEnvelopes): DmEnvelopePage {
  const envelopes: DmEnvelope[] = resolved.envelopes.map((e) => ({
    id: e.id,
    pubkey: e.pubkey,
    kind: e.kind,
    createdAt: e.createdAtSec,
    content: e.content,
    tags: e.tags,
    ...(e.sig ? { sig: e.sig } : {}),
  }));
  return {
    envelopes,
    hasNextPage: envelopes.length > 0,
    ...(resolved.received === undefined ? {} : { received: resolved.received }),
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
  until?: number;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
  readId?: string;
}): Promise<DmEnvelopePage> {
  const layer = buildNostrDataLayer();
  if (!layer) {
    paymentLog.debug('payment.dm.envelopes.no_tiers');
    return EMPTY_PAGE;
  }
  // The app's `until` (wrap arrival seconds) becomes the facade's cursor; only
  // the nagg tier honours it, the relay floor fetches the whole inbox.
  const result = await layer.getDmEnvelopes({
    viewerPubkey: args.viewer,
    ...(typeof args.until === 'number' ? { cursor: { createdAt: args.until, id: '' } } : {}),
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(args.refresh ? { refresh: true } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.readId ? { readId: args.readId } : {}),
  });
  return result.match(
    (resolved) => {
      paymentLog.debug('payment.dm.envelopes.resolved', {
        tier: resolved.tier,
        envelopes: resolved.envelopes.length,
      });
      const page = toDmEnvelopePage(resolved);
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
      throw new Error('Message history is unavailable', { cause: error });
    }
  );
}

/**
 * Live push of envelopes addressed to the viewer (relay tier only; a no-op
 * when no relay is enabled). Each arrival is delivered as a one-envelope page
 * so the consumer's existing decrypt/bucket path handles it; dedupe is the
 * consumer's (bucket latest-wins / seen-id set). Returns an unsubscribe.
 */
export function subscribeDmEnvelopesLive(
  viewer: string,
  onPage: (page: DmEnvelopePage) => void
): () => void {
  const layer = buildNostrDataLayer();
  if (!layer || !viewer) return () => {};
  return layer.subscribeDmEnvelopes({ viewerPubkey: viewer }, (envelope) => {
    const page = toDmEnvelopePage({ tier: 'relay', envelopes: [envelope], cursor: null });
    paymentLog.debug('payment.dm.envelopes.live', { envelopes: page.envelopes.length });
    onPage(page);
  });
}
