/**
 * @fileoverview NIP-17 Direct Message Hook
 *
 * Implements NIP-17 private direct messages for sending PaymentRequestPayload
 * via Nostr. Uses gift-wrapped messages (kind 1059) for privacy.
 *
 * Flow:
 * 1. Create kind 14 DM event (the actual message)
 * 2. Wrap in kind 13 seal (encrypted with NIP-44)
 * 3. Wrap in kind 1059 gift wrap (random throwaway key)
 * 4. Publish to recipient's relays
 */

import { useCallback, useState } from 'react';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { buildGiftWrappedDM } from 'utils/nip17';

// Default relay for payment requests
const DEFAULT_PAYMENT_RELAY = 'wss://relay.vertexlab.io';

const FALLBACK_PAYMENT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.8333.space/',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

interface SendDirectMessageOptions {
  /** Additional relays to publish to (besides those in nprofile) */
  additionalRelays?: string[];
}

interface UseNostrDirectMessageReturn {
  /** Send a NIP-17 direct message to an nprofile */
  sendDirectMessage: (
    nprofile: string,
    message: string,
    options?: SendDirectMessageOptions
  ) => Promise<void>;
  /** Whether a message is currently being sent */
  isSending: boolean;
  /** Error from the last send attempt */
  error: Error | null;
}

/**
 * Hook for sending NIP-17 private direct messages
 *
 * @example
 * ```tsx
 * const { sendDirectMessage, isSending, error } = useNostrDirectMessage();
 *
 * const handleSend = async () => {
 *   const payload: PaymentRequestPayload = { id: '...', mint: '...', unit: 'sat', proofs: [...] };
 *   await sendDirectMessage(nprofile, JSON.stringify(payload));
 * };
 * ```
 */
export function useNostrDirectMessage(): UseNostrDirectMessageReturn {
  const { ndk } = useNDK();
  const { keys: nostrKeys } = useNostrKeysContext();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendDirectMessage = useCallback(
    async (nprofile: string, message: string, options?: SendDirectMessageOptions) => {
      if (!ndk) {
        throw new Error('NDK not initialized');
      }

      if (!nostrKeys?.privateKey || !nostrKeys?.pubkey) {
        throw new Error('Nostr keys not available');
      }

      setIsSending(true);
      setError(null);

      try {
        // Decode the nprofile to get pubkey and relays
        const decoded = nip19.decode(nprofile);
        if (decoded.type !== 'nprofile') {
          throw new Error('Invalid nprofile format');
        }

        const { pubkey: recipientPubkey, relays: profileRelays } = decoded.data as ProfilePointer;

        // Combine relays: profile relays + additional relays + default relay
        const targetRelays = [
          ...(profileRelays || FALLBACK_PAYMENT_RELAYS),
          ...(options?.additionalRelays || FALLBACK_PAYMENT_RELAYS),
          DEFAULT_PAYMENT_RELAY,
        ].filter((relay, index, self) => self.indexOf(relay) === index); // Deduplicate

        // Build the NIP-17 gift-wrapped DM using the shared utility
        const giftWrap = buildGiftWrappedDM({
          content: message,
          senderPrivateKey: nostrKeys.privateKey,
          recipientPublicKey: recipientPubkey,
        });

        // Convert to NDKEvent for publishing via NDK relay management
        const wrapEvent = new NDKEvent(ndk);
        wrapEvent.kind = giftWrap.kind;
        wrapEvent.content = giftWrap.content;
        wrapEvent.tags = giftWrap.tags;
        wrapEvent.created_at = giftWrap.created_at;
        wrapEvent.pubkey = giftWrap.pubkey;
        wrapEvent.id = giftWrap.id;
        wrapEvent.sig = giftWrap.sig;

        // Connect to and publish to the target relays
        for (const relay of targetRelays) {
          try {
            const ndkRelay = ndk.addExplicitRelay(relay, undefined, true);
            await ndkRelay.connect(2500).catch(() => undefined);
          } catch (relayError) {
            console.warn(`Failed to connect to relay ${relay}:`, relayError);
          }
        }

        await wrapEvent.publish();

        console.log('[useNostrDirectMessage] Successfully sent NIP-17 DM:', {
          recipientPubkey: recipientPubkey.slice(0, 8) + '...',
          relays: targetRelays,
          wrapEventId: wrapEvent.id,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        console.error('[useNostrDirectMessage] Failed to send DM:', error);
        throw error;
      } finally {
        setIsSending(false);
      }
    },
    [ndk, nostrKeys]
  );

  return {
    sendDirectMessage,
    isSending,
    error,
  };
}
