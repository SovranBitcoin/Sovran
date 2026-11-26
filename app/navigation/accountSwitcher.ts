// What one account row in the drawer says, kept free of React Native so it can
// be unit-tested directly. Everything comes from the saved `ProfileEntry`
// (plus kind-0 metadata already in the cache): the drawer reads nothing new.

import * as nip19 from 'nostr-tools/nip19';

import { formatDisplayAmount } from '@/shared/lib/amountDisplay';

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

/**
 * The NIP-05 handle shown after the balance, or null when there is none. The
 * npub is not shown in the row: "Copy npub" in the account menu has it.
 */
export function accountHandle(nip05?: string | null): string | null {
  if (!nip05) return null;
  return nip05.startsWith('_@') ? `@${nip05.slice(2)}` : nip05;
}

/** The npub to copy, or null for a key that does not encode. */
export function accountNpub(pubkey: string): string | null {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
}
