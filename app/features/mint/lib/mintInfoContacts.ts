import * as nip19 from 'nostr-tools/nip19';

import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';
import { truncateMiddle } from '@/shared/lib/strings';

type MintInfoContactInput = {
  method: string;
  info: string | { toString(): string };
};

type MintInfoContactRow = {
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

/**
 * The pubkey behind a mint's Nostr contact row. NUT-06 is the primary source,
 * but some mints publish a placeholder there (minibits ships the literal
 * `npub…`), so nagg's discovery row — which resolves the operator from the
 * mint's own NIP-87 / kind-0 trail — fills the gap. Only used for a row that
 * IS a nostr contact: a mint with no nostr contact at all gets no invented row.
 */
export function resolveMintInfoNostrContactPubkey(
  contactRows: readonly Pick<MintInfoContactRow, 'method' | 'info' | 'isNostr'>[],
  discoveredOperatorPubkey: string | undefined
): string | undefined {
  const fromContact = getMintInfoNostrContactPubkey(contactRows);
  if (fromContact) return fromContact;
  const hasNostrRow = contactRows.some((row) => row.isNostr);
  return hasNostrRow && discoveredOperatorPubkey ? discoveredOperatorPubkey : undefined;
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
