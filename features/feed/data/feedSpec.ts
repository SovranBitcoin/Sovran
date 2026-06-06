import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
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

export function getCategoryPubkeysFromSpec(spec: string): string[] {
  const parsed = parseJson<Record<string, unknown>>(spec);
  if (!parsed) return [];
  if (parsed.id !== 'feed' || parsed.kind !== 'notes' || parsed.notes !== 'authored') return [];
  if (!Array.isArray(parsed.pubkeys)) return [];

  const seen = new Set<string>();
  const pubkeys: string[] = [];
  for (const value of parsed.pubkeys) {
    if (!isNostrPubkeyHex(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    pubkeys.push(value);
  }
  return pubkeys;
}
