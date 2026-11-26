import * as nip19 from 'nostr-tools/nip19';

import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';
import { isNostrPubkeyHex } from '@/shared/lib/protocolIds';
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
  if (!hasNostrRow || !discoveredOperatorPubkey) return undefined;
  return extractMintNostrPubkey({ contact: [{ method: 'nostr', info: discoveredOperatorPubkey }] });
}

export function formatMintInfoNostrFallback(info: string, pubkey?: string): string {
  const trimmed = info.trim();
  if (nip19.NostrTypeGuard.isNPub(trimmed)) {
    return truncateMiddle(trimmed);
  }
  if (pubkey && isNostrPubkeyHex(pubkey)) {
    return truncateMiddle(nip19.npubEncode(pubkey));
  }
  return truncateMiddle(trimmed);
}

/** Full npub string copied to the clipboard when tapping a mint's Nostr contact. */
export function getMintInfoNostrCopyValue(info: string, pubkey?: string): string {
  if (pubkey && isNostrPubkeyHex(pubkey)) {
    return nip19.npubEncode(pubkey);
  }
  return info.trim();
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

/**
 * Who a mint's operator contact row shows. Their own Nostr kind-0 name and
 * picture come first; only when those are missing does the row borrow the
 * mint's name and icon, rather than a bare npub and a generated avatar.
 * `mint` is passed only for the mint's own operator row, never for an extra
 * contact, and a profile still loading falls back to nothing so the row does
 * not flash the mint's icon before the operator's own picture arrives.
 */
export function resolveMintInfoContactIdentity(input: {
  profile: (NostrProfileNameFields & { picture?: string | null }) | null | undefined;
  fallbackTitle: string;
  loading: boolean;
  mint?: { name?: string | null; iconUrl?: string | null };
}): { title: string; picture: string | undefined } {
  const nostrName = getMintInfoNostrDisplayName(input.profile, '');
  const nostrPicture = input.profile?.picture?.trim() || undefined;
  const mintName = input.loading ? '' : (input.mint?.name?.trim() ?? '');
  const mintIcon = input.loading ? undefined : input.mint?.iconUrl?.trim() || undefined;
  return {
    title: nostrName || mintName || input.fallbackTitle,
    picture: nostrPicture ?? mintIcon,
  };
}
