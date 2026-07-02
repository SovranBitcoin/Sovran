import { useMemo } from 'react';

import { hasMintSupportingMethod, resolveReceiveMethodMint } from 'wallet';

import { useWalletContext } from '@/shared/providers/WalletContextProvider';
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
 */
export function useReceiveMethodMint(
  method: 'bolt12' | 'onchain',
  unit: string
): ReceiveMethodMintState {
  const explicit = useMintStore((s) => s.receiveMintByMethod[method]);
  const walletContext = useWalletContext();

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
