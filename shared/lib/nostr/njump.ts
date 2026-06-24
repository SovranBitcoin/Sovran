/**
 * @fileoverview Share-link builders for a Nostr event.
 *
 * Produces a NIP-21 `nostr:` URI and an `njump.me` web URL wrapping a NIP-19
 * `nevent` (with an optional relay hint so a recipient can fetch it). Used by
 * the per-post Share / Copy-link actions.
 */
import { tryNeventEncode } from '@/features/feed/components/nostr/feedParse';

interface ShareLinks {
  nevent: string;
  /** NIP-21 `nostr:nevent…`. */
  nostrUri: string;
  /** `https://njump.me/nevent…` (web-openable). */
  njumpUrl: string;
}

export function buildNostrUri(nevent: string): string {
  return `nostr:${nevent}`;
}

export function buildNjumpUrl(nevent: string): string {
  return `https://njump.me/${nevent}`;
}

/** Builds the share links for an event. Returns null if encoding fails. */
export function buildShareLinks(
  event: { id: string; pubkey: string; kind?: number },
  relayHint?: string
): ShareLinks | null {
  const nevent = tryNeventEncode(
    event.id,
    event.pubkey,
    event.kind,
    relayHint ? [relayHint] : undefined
  );
  if (!nevent) return null;
  return { nevent, nostrUri: buildNostrUri(nevent), njumpUrl: buildNjumpUrl(nevent) };
}
