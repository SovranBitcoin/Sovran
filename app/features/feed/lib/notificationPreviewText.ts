import { parseContent } from '@/features/feed/components/nostr/feedParse';
import type { ProfileInfo } from '@/features/feed/components/nostr/feedTypes';

/** Plain, non-interactive preview; preserve event content and resolve NIP-19
 * mentions only for display. Reuse the feed parser's checksum and size bounds. */
export function notificationPreviewText(
  content: string,
  profiles: ReadonlyMap<string, ProfileInfo> | undefined
): string {
  let preview = content.trim();
  for (const segment of parseContent(content)) {
    if (segment.kind !== 'npub' && segment.kind !== 'nprofile') continue;
    const name = profiles?.get(segment.pubkey)?.name;
    const label = name || `${segment.bech32.slice(0, 12)}…`;
    preview = preview.split(`nostr:${segment.bech32}`).join(`@${label}`);
  }
  return preview;
}
