import { useMemo } from 'react';

import { useBalanceContext } from '@cashu/coco-react';
import { routstrMintKey, spendableMintBalances } from '@/shared/lib/routstr/payingMint';

/**
 * The mints this wallet actually holds something in, canonicalised.
 *
 * Whether a provider is usable turns on this set: a Routstr node redeems ecash
 * only from the mints it publishes, so a provider that shares none of these is
 * one the user cannot pay. Canonicalised because nodes and wallets disagree
 * about trailing slashes and case, and an exact-match miss reads as "you hold
 * nothing it accepts".
 */
export function useHeldMints(): Set<string> {
  const { balances } = useBalanceContext();
  return useMemo(
    () =>
      new Set(
        Object.keys(spendableMintBalances(balances.byMint))
          .map(routstrMintKey)
          .filter((url) => url !== null)
      ),
    [balances]
  );
}
