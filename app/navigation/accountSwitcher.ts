// What one account row in the drawer says, kept free of React Native so it can
// be unit-tested directly. Everything comes from the saved `ProfileEntry`
// (plus kind-0 metadata already in the cache): the drawer reads nothing new.

import * as nip19 from 'nostr-tools/nip19';

import { formatDisplayAmount } from '@/shared/lib/amountDisplay';
import { truncateMiddle } from '@/shared/lib/strings';

/** Shown when this install has never seen an account's balance. */
export const UNKNOWN_BALANCE = '—';

/**
 * The account's last-known balance. A balance that was never recorded reads as
 * unknown, never as zero; a recorded zero reads as zero.
 */
export function formatCachedBalance(sats: number | null | undefined, displayBtc: number): string {
  if (typeof sats !== 'number' || !Number.isFinite(sats)) return UNKNOWN_BALANCE;
  return formatDisplayAmount(sats, 'sat', displayBtc);
}

/** The line under the name: the NIP-05 handle when known, else the shortened npub. */
export function accountSecondaryLine(pubkey: string, nip05?: string | null): string {
  if (nip05) return nip05.startsWith('_@') ? `@${nip05.slice(2)}` : nip05;
  try {
    return truncateMiddle(nip19.npubEncode(pubkey));
  } catch {
    return truncateMiddle(pubkey);
  }
}

/** The npub to copy, or null for a key that does not encode. */
export function accountNpub(pubkey: string): string | null {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
}

export function accountsCountLabel(count: number): string {
  return count === 1 ? '1 account' : `${count} accounts`;
}
