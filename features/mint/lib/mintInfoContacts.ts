import { nip19 } from 'nostr-tools';

import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';
import { truncateMiddle } from '@/shared/lib/strings';

export type MintInfoContactInput = {
  method: string;
  info: string | { toString(): string };
};

export type MintInfoContactRow = {
  method: string;
  info: string;
  isNostr: boolean;
  originalIndex: number;
};

type NostrProfileNameFields = {
  displayName?: string | null;
  display_name?: string | null;
  name?: string | null;
};

export function getSortedMintInfoContacts(
  contact: readonly MintInfoContactInput[] | undefined
): MintInfoContactRow[] {
  return (contact ?? [])
    .map((entry, originalIndex) => {
      const method = entry.method;
      const info = typeof entry.info === 'string' ? entry.info : entry.info.toString();
      return {
        method,
        info,
        isNostr: method.toLowerCase() === 'nostr',
        originalIndex,
      };
    })
    .sort((a, b) => Number(b.isNostr) - Number(a.isNostr) || a.originalIndex - b.originalIndex);
}

export function getMintInfoNostrContactPubkey(
  contactRows: readonly Pick<MintInfoContactRow, 'method' | 'info'>[]
): string | undefined {
  return extractMintNostrPubkey({ contact: contactRows });
}

export function formatMintInfoNostrFallback(info: string, pubkey?: string): string {
  const trimmed = info.trim();
  if (nip19.NostrTypeGuard.isNPub(trimmed)) {
    return truncateMiddle(trimmed, 10);
  }
  if (pubkey) {
    return truncateMiddle(nip19.npubEncode(pubkey), 10);
  }
  return truncateMiddle(trimmed, 10);
}

export function getMintInfoNostrDisplayName(
  profile: NostrProfileNameFields | null | undefined,
  fallback: string
): string {
  return (
    profile?.displayName?.trim() ||
    profile?.display_name?.trim() ||
    profile?.name?.trim() ||
    fallback
  );
}
