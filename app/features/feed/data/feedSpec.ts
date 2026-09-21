import { parseJsonRecord } from '@/features/feed/components/nostr/feedParse';

export function hydrateSpecWithPubkey(spec: string, pubkey: string | undefined): string {
  if (!pubkey) return spec;
  const parsed = parseJsonRecord(spec);
  if (!parsed || typeof parsed !== 'object') return spec;
  const hasExplicitPubkeys = Array.isArray(parsed.pubkeys);
  if (parsed.id === 'feed' && !parsed.pubkey && !hasExplicitPubkeys) {
    return JSON.stringify({ ...parsed, pubkey });
  }
  return spec;
}

export function hasEmptyExplicitPubkeys(spec: string): boolean {
  const parsed = parseJsonRecord(spec);
  return !!parsed && Array.isArray(parsed.pubkeys) && parsed.pubkeys.length === 0;
}
