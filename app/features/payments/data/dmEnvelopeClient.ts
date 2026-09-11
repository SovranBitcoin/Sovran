/** Shared opaque DM inbox for Contacts and conversation history. Decryption and peer filtering stay on-device. */
import type { DmEnvelopePage } from './dmEnvelopeTypes';
import { paymentLog } from '@/shared/lib/logger';
import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { resolvedDmEnvelopesToPage, toFacadeDmEnvelopesRequest } from './facadeDmAdapter';

const EMPTY_PAGE: DmEnvelopePage = { envelopes: [], hasNextPage: false };

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
      throw new Error('Message history is unavailable', { cause: error });
    }
  );
}
