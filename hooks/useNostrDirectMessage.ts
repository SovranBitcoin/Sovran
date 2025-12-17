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
import { NDKEvent, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import { nip19, nip44, getPublicKey, generateSecretKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

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
 * Generate a random timestamp within the last 2 days for gift wrap privacy
 */
function randomTimeUpTo2DaysInThePast(): number {
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800);
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

        // Convert private key to hex string for nip44
        const senderPrivateKeyHex = bytesToHex(nostrKeys.privateKey);
        const senderPublicKey = nostrKeys.pubkey;

        // 1. Create kind 14 DM event (the actual message content)
        // This is the innermost layer - the actual direct message
        const dmEvent = {
          kind: 14,
          content: message,
          tags: [['p', recipientPubkey]],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: senderPublicKey,
        };

        // Calculate the event id for the DM
        const dmEventForHash = {
          ...dmEvent,
          id: '', // Will be calculated
        };
        // We need to create a proper NDK event to get the hash
        const tempDmNdkEvent = new NDKEvent(ndk);
        tempDmNdkEvent.kind = dmEvent.kind;
        tempDmNdkEvent.content = dmEvent.content;
        tempDmNdkEvent.tags = dmEvent.tags;
        tempDmNdkEvent.created_at = dmEvent.created_at;
        tempDmNdkEvent.pubkey = dmEvent.pubkey;
        // The ID will be set when we serialize
        const dmEventString = JSON.stringify({
          ...dmEvent,
          id: tempDmNdkEvent.id || '',
        });

        // 2. Create kind 13 seal event (encrypted with NIP-44)
        // The seal encrypts the DM event and is signed by the sender
        const conversationKey = nip44.v2.utils.getConversationKey(
          senderPrivateKeyHex,
          recipientPubkey
        );
        const sealedContent = nip44.v2.encrypt(dmEventString, conversationKey);

        // Create and sign the seal with sender's key
        const sealEvent = new NDKEvent(ndk);
        sealEvent.kind = 13;
        sealEvent.content = sealedContent;
        sealEvent.created_at = randomTimeUpTo2DaysInThePast();
        sealEvent.pubkey = senderPublicKey;
        sealEvent.tags = [];

        const senderSigner = new NDKPrivateKeySigner(senderPrivateKeyHex);
        await sealEvent.sign(senderSigner);

        const sealEventString = JSON.stringify(await sealEvent.toNostrEvent());

        // 3. Create kind 1059 gift wrap (random throwaway key)
        // The gift wrap hides the sender's identity from relays
        const randomPrivateKey = generateSecretKey();
        const randomPublicKey = getPublicKey(randomPrivateKey);
        const randomPrivateKeyHex = bytesToHex(randomPrivateKey);

        // Encrypt the seal with the random key to the recipient
        const wrapConversationKey = nip44.v2.utils.getConversationKey(
          randomPrivateKeyHex,
          recipientPubkey
        );
        const wrappedContent = nip44.v2.encrypt(sealEventString, wrapConversationKey);

        // Create the gift wrap event with the random key
        const randomSigner = new NDKPrivateKeySigner(randomPrivateKeyHex);

        const wrapEvent = new NDKEvent(ndk);
        wrapEvent.kind = 1059;
        wrapEvent.tags = [['p', recipientPubkey]];
        wrapEvent.content = wrappedContent;
        wrapEvent.created_at = randomTimeUpTo2DaysInThePast();
        wrapEvent.pubkey = randomPublicKey;

        await wrapEvent.sign(randomSigner);

        // 4. Publish to target relays
        // We need to explicitly connect to and publish to the target relays
        for (const relay of targetRelays) {
          try {
            await ndk.pool.ensureRelay(relay);
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
