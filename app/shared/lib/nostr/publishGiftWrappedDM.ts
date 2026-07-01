/**
 * @fileoverview Publish a NIP-17 gift-wrapped DM (recipient wrap + self-copy)
 * through an NDK instance.
 *
 * This is the same two-event publish the chat composer performs inline
 * (`UserMessagesScreen` → `buildGiftWrappedDMPair` + two `NDKEvent.publish()`
 * calls): one kind-1059 wrap addressed to the recipient, and one self-copy wrap
 * so the sender can retrieve their own sent message. The self-copy is what makes
 * a sent token show up in the sender's own DM thread.
 *
 * Used by the Send flow to deliver a bearer ecash token to a remote Nostr
 * contact: the encrypted gift wrap keeps the token private to the recipient's
 * npub, so a bearer token is safe to send this way (unlike a public broadcast).
 */

import NDK, { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import type { VerifiedEvent } from 'nostr-tools';

import { buildGiftWrappedDMPair } from './nip17';
import { nostrLog } from '@/shared/lib/logger';

function toNdkEvent(ndk: NDK, wrap: VerifiedEvent): NDKEvent {
  const event = new NDKEvent(ndk);
  event.kind = wrap.kind;
  event.content = wrap.content;
  event.tags = wrap.tags;
  event.created_at = wrap.created_at;
  event.pubkey = wrap.pubkey;
  event.id = wrap.id;
  event.sig = wrap.sig;
  return event;
}

/**
 * Build and publish a NIP-17 gift-wrapped DM pair. Resolves once the recipient
 * wrap is accepted by a relay; the self-copy publish is best-effort (its failure
 * only costs the local thread echo, not delivery). Rejects if the recipient wrap
 * fails to publish — callers MUST treat a rejection as "not delivered" and keep
 * the funds recoverable (do not navigate away as if it succeeded).
 */
export async function publishGiftWrappedDM(params: {
  ndk: NDK;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  content: string;
  extraTags?: string[][];
}): Promise<void> {
  const { ndk, senderPrivateKey, recipientPublicKey, content, extraTags } = params;
  const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
    content,
    senderPrivateKey,
    recipientPublicKey,
    ...(extraTags ? { extraTags } : {}),
  });

  await toNdkEvent(ndk, recipientWrap).publish();
  nostrLog.info('nostr.giftWrapDM.published', { eventId: recipientWrap.id });

  await toNdkEvent(ndk, senderWrap)
    .publish()
    .catch((err: unknown) => {
      nostrLog.warn('nostr.giftWrapDM.self_copy_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
