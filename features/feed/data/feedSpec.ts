import { parseJson } from '@/features/feed/components/nostr/feedParse';

export function hydrateSpecWithPubkey(spec: string, pubkey: string | undefined): string {
  if (!pubkey) return spec;
  const parsed = parseJson<Record<string, unknown>>(spec);
  if (!parsed || typeof parsed !== 'object') return spec;
  const hasExplicitPubkeys = Array.isArray(parsed.pubkeys);
  if (parsed.id === 'feed' && !parsed.pubkey && !hasExplicitPubkeys) {
    return JSON.stringify({ ...parsed, pubkey });
  }
  return spec;
}

export function hasEmptyExplicitPubkeys(spec: string): boolean {
  const parsed = parseJson<Record<string, unknown>>(spec);
  return !!parsed && Array.isArray(parsed.pubkeys) && parsed.pubkeys.length === 0;
}
