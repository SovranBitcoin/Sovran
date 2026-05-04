import { useEffect } from 'react';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useWhitenoise } from '../WhitenoiseContext';
import { resolveInboxRelays } from '../client/network';
import { wnLog } from '@/shared/lib/logger';

const GIFT_WRAP_KIND = 1059;

/**
 * Long-running subscription that watches for incoming gift-wrapped events
 * (kind 1059) addressed to the active user, hands them to marmot-ts's
 * `InviteReader` for dedup + decryption, and stops there. The decrypted
 * Welcome rumors land in the InviteReader's `unread` store, where the
 * Contacts > Requests UI surfaces them for the user to accept or decline.
 *
 * Auto-joining was a bug: it let any unknown sender silently consume one
 * of our key packages and force a group join. The InviteReader provides
 * the canonical request queue (received → unread → user action) for
 * exactly this reason.
 *
 * Mounted inside WhitenoiseProvider so it runs for the lifetime of the
 * account scope.
 */
export function useWhitenoiseInbox() {
  const { client, inviteReader, relays } = useWhitenoise();
  const { keys } = useNostrKeysContext();
  const selfPubkey = keys?.pubkey;

  useEffect(() => {
    if (!client || !inviteReader || !selfPubkey) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      // Prefer the user's published kind-10051 inbox relays if any; fall
      // back to the default app relay set.
      const inboxRelays = await resolveInboxRelays(client.network, selfPubkey, relays);
      if (cancelled) return;

      wnLog.info('whitenoise.inbox.start', {
        relayCount: inboxRelays.length,
        self: selfPubkey.slice(0, 16),
      });

      const sub = client.network.subscription(inboxRelays, [
        { kinds: [GIFT_WRAP_KIND], '#p': [selfPubkey] },
      ]);

      const handle = sub.subscribe({
        next: (event) => {
          handleGiftWrap(event).catch((err: unknown) => {
            wnLog.warn('whitenoise.inbox.handle_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
        error: (err) => {
          wnLog.warn('whitenoise.inbox.subscription_error', {
            error: err instanceof Error ? err.message : String(err),
          });
        },
      });

      unsubscribe = () => handle.unsubscribe();
    })();

    async function handleGiftWrap(event: unknown): Promise<void> {
      const ev = event as { id?: string; kind?: number };
      if (!ev?.id || ev.kind !== GIFT_WRAP_KIND) return;
      const reader = inviteReader;
      if (!reader) return;

      // Stage 1: ingest into the `received` store. Returns false if we've
      // seen this event before (deduped via the InviteReader's `seen` map).
      const fresh = await reader.ingestEvent(event as Parameters<typeof reader.ingestEvent>[0]);
      if (cancelled) return;
      if (!fresh) return;

      // Stage 2: decrypt now. Our signer is local (no hardware prompt), so
      // we don't need to wait for an explicit user action. Non-Marmot
      // gift-wraps (e.g. NIP-17 plain DMs) get rejected here as
      // `kind !== WELCOME_EVENT_KIND` and emit an `error` event we ignore.
      try {
        const rumor = await reader.decryptGiftWrap(ev.id);
        if (cancelled) return;
        if (rumor) {
          wnLog.info('whitenoise.inbox.invite_received', {
            eventId: ev.id.slice(0, 8),
            from: rumor.pubkey.slice(0, 16),
          });
        }
      } catch (err) {
        if (cancelled) return;
        wnLog.debug('whitenoise.inbox.decrypt_skipped', {
          eventId: ev.id.slice(0, 8),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, inviteReader, selfPubkey, relays]);
}
