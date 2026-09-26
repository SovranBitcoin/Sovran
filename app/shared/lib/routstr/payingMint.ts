import { normalizeMintUrl, type BalanceSnapshot } from '@cashu/coco-core';
import { z } from 'zod';

import { amountToNumber } from '@/shared/lib/cashu/amount';
import { isTestnutMint } from '@/shared/stores/global/mintTestnutStore';

const MintUrl = z.httpUrl();

export function routstrMintKey(value: string): string | null {
  const parsed = MintUrl.safeParse(value);
  return parsed.success ? normalizeMintUrl(parsed.data) : null;
}

/**
 * Only spendable sats can fund a request; reserved proofs, other units and
 * testnut mints cannot. A testnut's sats are backed by a fake Lightning
 * backend: they sit in their own account everywhere else in the wallet, and a
 * provider paid with them is paid nothing. React callers pass the reactive
 * predicate (`useIsTestnutMint`) so a verdict landing later re-derives them.
 */
export function spendableMintBalances(
  snapshots: Readonly<Record<string, Pick<BalanceSnapshot, 'spendable' | 'unit'>>>,
  isTestnut: (mintUrl: string) => boolean = isTestnutMint
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(snapshots).flatMap(([url, snapshot]) => {
      const sats = amountToNumber(snapshot.spendable);
      return snapshot.unit === 'sat' && Number.isSafeInteger(sats) && sats > 0 && !isTestnut(url)
        ? [[url, sats]]
        : [];
    })
  );
}

/** UI and execution choose one mint, never a sum that requires multiple tokens. */
export function selectPayingMint(input: {
  selectedMint: string | null | undefined;
  acceptedMints: readonly string[] | null;
  balances: Readonly<Record<string, number>>;
}): { mintUrl: string; balanceSats: number } | null {
  const accepted = input.acceptedMints?.length
    ? new Set(input.acceptedMints.map(routstrMintKey).filter((url) => url !== null))
    : null;
  const candidates = Object.entries(input.balances).filter(
    ([url, sats]) =>
      Number.isSafeInteger(sats) &&
      sats > 0 &&
      (!accepted || accepted.has(routstrMintKey(url) ?? ''))
  );
  const selectedKey = input.selectedMint ? routstrMintKey(input.selectedMint) : null;
  const selected = candidates.find(
    ([url]) => selectedKey !== null && routstrMintKey(url) === selectedKey
  );
  const winner =
    selected ?? candidates.sort(([aUrl, a], [bUrl, b]) => b - a || aUrl.localeCompare(bUrl))[0];
  return winner ? { mintUrl: winner[0], balanceSats: winner[1] } : null;
}
