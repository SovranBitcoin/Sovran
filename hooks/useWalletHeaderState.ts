/**
 * Wallet tab header state: mint info and balance label.
 *
 * headerAmountLabel uses formatAmount with useUserPreference, which reads the
 * display setting imperatively. We subscribe to displayBtc reactively here so
 * switching between BTC/sats display updates the label without waiting for a
 * balance change.
 */

import { useEffect, useMemo, useState } from 'react';

import { formatAmount } from 'helper/currency';
import { getMintDisplayName } from '@/helper/url';
import { useSettingsStore } from 'stores/settingsStore';

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

  const displayBtc = useSettingsStore((s) => s.displayBtc);

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

  const headerAmountLabel = useMemo(
    () => formatAmount({ amount: balanceForMint, unit: 'sat' }, { useUserPreference: true }),
    [balanceForMint, displayBtc]
  );

  return {
    headerMintName,
    headerAmountLabel,
    headerMintInfo,
  };
}
