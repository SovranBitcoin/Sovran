import { useEffect } from 'react';
import { getMintMethodCapability, type WalletContext } from 'wallet';

import { useReceiveMethodMint } from '@/features/receive/hooks/useReceiveMethodMint';
import { deriveBip321RailSelection } from '@/features/receive/lib/bip321RailSelection';
import { useMintStore } from '@/shared/stores/profile/mintStore';

export function useBip321RailSelection(
  unit: string,
  walletContext: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities'>
) {
  const { mintUrl: onchainMint } = useReceiveMethodMint('onchain', unit);
  const { mintUrl: bolt12Mint } = useReceiveMethodMint('bolt12', unit);
  const excluded = useMintStore((s) => s.bip321ExcludedRails);
  const resetExclusions = useMintStore((s) => s.resetBip321RailExclusions);
  const onchainCapability = onchainMint
    ? getMintMethodCapability(walletContext, onchainMint, {
        operation: 'mint',
        method: 'onchain',
        unit,
      })
    : null;
  const bolt12Capability = bolt12Mint
    ? getMintMethodCapability(walletContext, bolt12Mint, {
        operation: 'mint',
        method: 'bolt12',
        unit,
      })
    : null;
  const available = {
    onchain: !!onchainCapability?.supported && !onchainCapability.disabled,
    bolt12: !!bolt12Capability?.supported && !bolt12Capability.disabled,
    creq: walletContext.trustedMintUrls.length > 0,
  };
  const selection = deriveBip321RailSelection({ available, excluded });
  selection.rails = selection.rails.map((rail) => {
    if (rail.state !== 'unavailable') return rail;
    const capability = rail.id === 'onchain' ? onchainCapability : bolt12Capability;
    const reason =
      rail.id === 'creq'
        ? `No trusted mint is available for Cashu requests in ${unit}`
        : capability?.disabled
          ? `${rail.label} is disabled by the selected mint for ${unit}`
          : `No trusted mint supports ${rail.id === 'onchain' ? 'onchain' : rail.label} for ${unit}`;
    return { ...rail, reason };
  });

  useEffect(() => {
    if (selection.needsExclusionReset) {
      resetExclusions(
        selection.rails.filter((rail) => rail.state === 'included').map((rail) => rail.id)
      );
    }
  }, [selection, resetExclusions]);

  return { selection, onchainMint, bolt12Mint, excluded };
}
