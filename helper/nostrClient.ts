import { NDKEvent } from '@nostr-dev-kit/ndk';
import ndk from 'components/ndk';
import { finalizeEvent, getPublicKey, nip04, nip19 } from 'nostr-tools';

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Nostr event type for recommendation events
 */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  kind?: number;
}

interface SendEncryptedDirectMessage {
  message: string;
  recipientPublicKey: string;
  nsec: string;
}

export const sendEncryptedDirectMessage = async ({
  nsec,
  recipientPublicKey,
  message,
}: SendEncryptedDirectMessage): Promise<NDKEvent> => {
  const privKeyBytes = nip19.decode(nsec).data as Uint8Array;
  const privateKey = bytesToHex(privKeyBytes);
  const pubkey = getPublicKey(privKeyBytes);

  // Encrypt the message content
  const content = await nip04.encrypt(privateKey, recipientPublicKey, message);

  // Construct the Kind 4 event
  const event = {
    kind: 4,
    tags: [['p', recipientPublicKey]],
    content,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    id: '',
    sig: '',
  };

  const signedEvent = await finalizeEvent(event, hexToBytes(privateKey));

  if (!signedEvent) {
    throw new Error("Couldn't sign the event!");
  }

  const e = new NDKEvent(ndk, { ...signedEvent });

  await e.publish();

  return e;
};

/**
 * Parse recommendation score/comment from event content
 * Format: "[score/5] comment"
 * @param raw - Raw event content string
 * @returns Parsed recommendation with score and comment, or null if invalid
 */
export function parseRecommendation(raw: string): { score: number; comment: string } | null {
  const match = raw.match(/^\s*\[(\d+)\/(\d+)\]\s*(.*)$/);
  if (!match) return null;
  const score = parseInt(match[1], 10);
  const outOf = parseInt(match[2], 10);
  const comment = match[3] ?? '';
  if (!Number.isFinite(score) || score < 0 || score > 5) return null;
  if (outOf !== 5) return null;
  return { score, comment };
}

/**
 * Validate event is a Cashu recommendation event
 * Checks for k tag with value "38172" indicating it's recommending a mint
 * @param e - Nostr event to validate
 * @returns True if event is a Cashu recommendation
 */
export function isCashuRecommendationEvent(e: NostrEvent): boolean {
  const kindTag = e.tags.find((t) => t[0] === 'k');
  return Boolean(kindTag && kindTag[1] === '38172');
}

/**
 * Extract mint URL from u tag in event
 * @param e - Nostr event containing mint URL
 * @returns Mint URL string or null if not found
 */
export function extractMintUrlFromEvent(e: NostrEvent): string | null {
  const urlTag = e.tags.find((t) => t[0] === 'u');
  return urlTag?.[1] || null;
}
