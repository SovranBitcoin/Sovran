import { MintSelector } from '@/features/wallet';
import { useWalletMintListRequest } from '@/features/wallet/hooks/useWalletMintListRequest';
import { SearchLayout } from '@/shared/ui/composed/SearchLayout';

export { useSearchContext } from '@/shared/ui/composed/SearchLayout';

export default function HomeLayout() {
  const handleRequestMintList = useWalletMintListRequest();

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
      searchTestIDPrefix="wallet"
      renderIdleTitle={() => (
        <MintSelector testID="wallet-mint-selector" onRequestMintList={handleRequestMintList} />
      )}
    />
  );
}
