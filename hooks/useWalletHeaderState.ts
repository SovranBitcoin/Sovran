/**
 * Wallet tab header state: mint info and balance label.
 * Layout uses getHeaderTitleWidth/getHeaderTitleHeight from @/constants/wallet-header.
 */

import { useEffect, useMemo, useState } from 'react';
import { formatAmount } from 'helper/currency';
import { getMintDisplayName } from '@/helper/url';

interface UseWalletHeaderStateArgs {
  selectedMint: string | undefined;
  balanceForMint: number;
  getMintInfo: (mintUrl: string) => Promise<{ name?: string; icon_url?: string } | null>;
}

export function useWalletHeaderState({
  selectedMint,
  balanceForMint,
  getMintInfo,
}: UseWalletHeaderStateArgs) {
  const [headerMintInfo, setHeaderMintInfo] = useState<{
    name?: string;
    icon_url?: string;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!selectedMint) {
        if (isMounted) setHeaderMintInfo(null);
        return;
      }
      try {
        const info = await getMintInfo(selectedMint);
        if (isMounted) setHeaderMintInfo(info);
      } catch {
        if (isMounted) setHeaderMintInfo(null);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [selectedMint, getMintInfo]);

  const headerMintName = selectedMint
    ? getMintDisplayName(selectedMint, { name: headerMintInfo?.name })
    : 'Change Mint';

  const headerAmountLabel = useMemo(() => {
    const val = formatAmount({ amount: balanceForMint, unit: 'sat' }, { useUserPreference: true });
    return `${val} sats`;
  }, [balanceForMint]);

  return {
    headerMintName,
    headerAmountLabel,
    headerMintInfo,
  };
}
