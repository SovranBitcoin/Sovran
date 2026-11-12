import { accountMintUrls } from 'wallet';

import { useReceiveMethodMint } from '@/features/receive/hooks/useReceiveMethodMint';
import { deriveBip321RailSelection } from '@/features/receive/lib/bip321RailSelection';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

export function useBip321RailSelection(unit: string) {
  const onchain = useReceiveMethodMint('onchain', unit);
  const bolt12 = useReceiveMethodMint('bolt12', unit);
  const available = {
    onchain: onchain.supported,
    bolt12: bolt12.supported,
    creq: accountMintUrls(useWalletContext()).length > 0,
  };
  const selection = deriveBip321RailSelection({ available });
  selection.rails = selection.rails.map((rail) => {
    if (rail.state !== 'unavailable') return rail;
    const capability = rail.id === 'onchain' ? onchain.capability : bolt12.capability;
    const reason =
      rail.id === 'creq'
        ? `No trusted mint is available for Cashu requests in ${unit}`
        : capability?.disabled
          ? `${rail.label} is disabled by the selected mint for ${unit}`
          : `No trusted mint supports ${rail.id === 'onchain' ? 'onchain' : rail.label} for ${unit}`;
    return { ...rail, reason };
  });

  return { selection, onchainMint: onchain.mintUrl, bolt12Mint: bolt12.mintUrl };
}
