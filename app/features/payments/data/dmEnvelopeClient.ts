/**
 * The viewer's opaque DM inbox, as the ecash auto-redeem reads it. Decryption
 * and peer filtering stay on-device.
 *
 * The inbox is an INDEX only: it returns the opaque encrypted envelopes (kind
 * 1059 gift wraps + kind 4 legacy) that reference the viewer. Decryption,
 * sender identification, and bucketing stay client-side in `dmDecryptPipeline`.
 *
 * Reads go through the payment inbox (`paymentInbox.ts`), not the social data
 * layer: ecash in a message is money and must keep arriving whatever
 * Settings → Network has switched off.
 */
import type { facade } from 'nostr';

import type { DmEnvelope, DmEnvelopePage } from './dmEnvelopeTypes';
import { paymentLog } from '@/shared/lib/logger';
import { getPaymentInbox } from '@/shared/lib/nostr/paymentInbox';

const EMPTY_PAGE: DmEnvelopePage = { envelopes: [], hasNextPage: false };

/** Map a resolved answer to the app's `DmEnvelopePage`. A relay cannot page
 *  gift wraps (their dates are randomised), says so with a null cursor, and
 *  has by then returned everything it holds for the request: that page is the
 *  last. Asking again would have every relay send the same inbox a second
 *  time. A transport that does page keeps going while pages hold envelopes. */
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
    hasNextPage: envelopes.length > 0 && resolved.cursor !== null,
    ...(resolved.received === undefined ? {} : { received: resolved.received }),
  };
}

/**
 * DM envelopes addressed to the viewer (kind 1059/4 by `#p`), from the relays.
 *
 * Without `since` this is the whole inbox: gift-wrap `created_at` is
 * randomised, so no limit is sent. A caller that has already read the inbox
 * passes `since` (event `created_at`, with an overlap covering the two days
 * NIP-59 backdates a wrap by) to read only what may be new. The envelopes stay
 * opaque; decryption happens above in `dmDecryptPipeline`.
 */
export async function fetchDmEnvelopes(args: {
  viewer: string;
  until?: number;
  /** Inclusive `created_at` lower bound; the caller owns the backdating overlap. */
  since?: number;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
  readId?: string;
}): Promise<DmEnvelopePage> {
  const layer = getPaymentInbox();
  if (!layer) {
    paymentLog.debug('payment.dm.envelopes.no_tiers');
    return EMPTY_PAGE;
  }
  // The app's `until` (wrap arrival seconds) becomes the cursor; a relay does
  // not honour it and returns everything at or after `since`.
  const result = await layer.getDmEnvelopes({
    viewerPubkey: args.viewer,
    ...(typeof args.until === 'number' ? { cursor: { createdAt: args.until, id: '' } } : {}),
    ...(typeof args.since === 'number' ? { since: args.since } : {}),
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
      return toDmEnvelopePage(resolved);
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
 * Live push of envelopes addressed to the viewer. Each arrival is delivered as
 * a one-envelope page so the consumer's existing decrypt path handles it;
 * dedupe is the consumer's (seen-id set). A dropped relay socket is
 * re-attached with backoff and resumes from what that relay last sent, so a
 * reconnect does not replay the whole inbox. Returns an unsubscribe.
 */
export function subscribeDmEnvelopesLive(
  viewer: string,
  onPage: (page: DmEnvelopePage) => void
): () => void {
  const layer = getPaymentInbox();
  if (!layer || !viewer) return () => {};
  return layer.subscribeDmEnvelopes({ viewerPubkey: viewer }, (envelope) => {
    const page = toDmEnvelopePage({ tier: 'relay', envelopes: [envelope], cursor: null });
    paymentLog.debug('payment.dm.envelopes.live', { envelopes: page.envelopes.length });
    onPage(page);
  });
}
