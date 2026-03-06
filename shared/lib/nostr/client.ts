import { nip19 } from 'nostr-tools';

/**
 * Converts an npub-encoded Nostr public key to its hex representation.
 * Returns the input unchanged if it doesn't start with 'npub'.
 */
export function npubToPubkey(npub: string): string {
  if (!npub) return '';

  if (npub.startsWith('npub')) {
    const data = nip19.decode(npub);
    if (data.type === 'npub') {
      return data.data;
    }
  }
  return npub;
}

/** Like npubToPubkey but returns null on invalid input instead of echoing it back. */
export function npubToPubkeySafe(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

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
