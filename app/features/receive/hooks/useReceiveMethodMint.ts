import { useMemo } from 'react';

import { hasMintSupportingMethod, resolveReceiveMethodMint } from 'wallet';

import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useIsTestnutMint } from '@/shared/stores/global/mintTestnutStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { paymentLog } from '@/shared/lib/logger';

interface ReceiveMethodMintState {
  /** The mint backing this rail right now (explicit pick or auto-derived). */
  mintUrl: string | undefined;
  /** How the mint was chosen — colada's resolveReceiveMethodMint policy. */
  source: 'explicit' | 'auto' | 'none';
  /** Whether ANY trusted mint could serve this rail (drives the empty state). */
  anyMintSupports: boolean;
}

/**
 * The "Receiving with" mint for a standing receive rail. The four mint
 * selections (preferred, npub.cash, bolt12, onchain) are independent: this
 * never falls back to the hub/NPC mint. Explicit picks persist in
 * `mintStore.receiveMintByMethod`; the auto default (first trusted mint
 * supporting the method) is derived per render, so trusting a capable mint
 * populates the rail immediately and untrusting one self-heals.
 *
 * One pick per method is shared by every account, so a pick on the other side
 * of the testnut split (a testnut mint while a real account is active, or the
 * reverse) is set aside for the auto default instead of backing the rail —
 * `walletContext` already limits the auto default to the active account.
 */
export function useReceiveMethodMint(
  method: 'bolt12' | 'onchain',
  unit: string
): ReceiveMethodMintState {
  const picked = useMintStore((s) => s.receiveMintByMethod[method]);
  const walletContext = useWalletContext();
  const { testnut } = useActiveUnit();
  const isTestnutMint = useIsTestnutMint();
  const explicit = picked && isTestnutMint(picked) === testnut ? picked : undefined;

  return useMemo(() => {
    const requirement = { operation: 'mint' as const, method, unit };
    const resolution = resolveReceiveMethodMint(walletContext, explicit, requirement);
    const anyMintSupports = hasMintSupportingMethod(walletContext, requirement);
    paymentLog.debug(`receive.${method}.mint_resolved`, {
      source: resolution.source,
      anyMintSupports,
      unit,
    });
    return {
      mintUrl: resolution.mintUrl ?? undefined,
      source: resolution.source,
      anyMintSupports,
    };
  }, [walletContext, explicit, method, unit]);
}
