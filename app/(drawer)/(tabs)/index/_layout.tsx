import { useCallback } from 'react';

import { usePaymentFlowMachine } from 'colada/react';
import { MintSelector } from '@/features/wallet';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { SearchLayout } from '@/shared/ui/composed/SearchLayout';

export { useSearchContext } from '@/shared/ui/composed/SearchLayout';

export default function HomeLayout() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector({ reset: true });
  }, [machine]);

  // Shared inline header search, like Feed/Contacts. `transparent` keeps the
  // wallpaper showing through the header; the wallet's MintSelector stays as the
  // idle title (GlassSearchBar takes over while searching). The drawer button +
  // search toggle are supplied by SearchLayout. WalletScreen reads the search
  // context and renders the people-search view in place while searching.
  return (
    <SearchLayout
      title="Wallet"
      placeholder="Search people..."
      transparent
      renderIdleTitle={() => <MintSelector onRequestMintList={handleRequestMintList} />}
    />
  );
}
