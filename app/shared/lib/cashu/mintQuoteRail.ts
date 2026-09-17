/**
 * @fileoverview Which receive rail a mint quote belongs to.
 *
 * Receiving is one Cashu operation — a NUT-04 mint quote — but it has three
 * presentations: Lightning, onchain, and one shared screen for every method
 * that has no NUT of its own (`venmo`, `paypal`, a bank rail). Two places have
 * to make that choice: the live receive flow when a quote is created, and the
 * transactions list when a past one is reopened. Both ask here, so a quote can
 * never open one screen live and a different one from history.
 *
 * The answer is the method string, which `defaultOperations.executeMintQuote`
 * stamps on the entry's metadata because coco's `MintHistoryEntry` has no
 * method field. Entries written before that carry none, so the onchain address
 * check remains as the fallback that identifies them — the same shape
 * `syncMeltDetailPathname` uses on the send side.
 */

import type { HistoryEntry } from '@cashu/coco-core';
import { isBuiltInMintPaymentMethod } from 'wallet';

import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';

/** The three mint-quote presentations. */
export type MintQuoteRail = 'lightning' | 'onchain' | 'custom';

/**
 * The mint-advertised method a quote was created with.
 *
 * Defaults to `bolt11`: it is the only method a quote could have been created
 * with before custom methods existed, so an entry with no recorded method is a
 * Lightning one (or an onchain one, which `mintQuoteRail` detects by address).
 */
export function mintQuoteMethod(entry: { metadata?: unknown } | null | undefined): string {
  const metadata = entry?.metadata;
  const method =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).method
      : undefined;
  return typeof method === 'string' && method ? method : 'bolt11';
}

export function mintQuoteRail(entry: HistoryEntry | null | undefined): MintQuoteRail {
  // The address check comes first because it is the one signal that works on
  // an entry with no recorded method, and it can only ever be true for onchain.
  if (entry && getOnchainMintAddress(entry)) return 'onchain';
  const method = mintQuoteMethod(entry);
  if (method === 'onchain') return 'onchain';
  // bolt11 and bolt12 are both Lightning-family payloads the Lightning screen
  // presents; anything outside the built-ins is a custom method.
  return isBuiltInMintPaymentMethod(method) ? 'lightning' : 'custom';
}
