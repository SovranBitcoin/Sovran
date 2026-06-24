import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { MintSelector } from '@/features/wallet';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { SearchLayout } from '@/shared/ui/composed/SearchLayout';
import { cashuLog } from '@/shared/lib/logger';

export { useSearchContext } from '@/shared/ui/composed/SearchLayout';

export default function HomeLayout() {
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleRequestMintList = () => {
    cashuLog.info('wallet.header.mint_selector.request', {
      source: 'wallet-header',
      trustedMintCount: walletContext.trustedMintUrls.length,
      hasPreferredMint: !!walletContext.preferredMintUrl,
    });
    clearPaymentContext('wallet.mint_selector');
    void machine.requestMintSelector({ reset: true });
  };

  // Shared inline header search, like Feed/Contacts. `transparent` keeps the
  // wallpaper showing through the header; the wallet's MintSelector stays as the
  // idle title (GlassSearchBar takes over while searching). The drawer button +
  // search toggle are supplied by SearchLayout. WalletScreen layers the shared
  // search overlay above the mounted wallet body while searching.
  return (
    <SearchLayout
      title="Wallet"
      placeholder="Search people..."
      transparent
      renderIdleTitle={() => <MintSelector onRequestMintList={handleRequestMintList} />}
    />
  );
}
