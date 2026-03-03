/**
 * Wallet tab header state: mint info and balance label.
 *
 * Reads mint info synchronously from the mints array loaded by useMintManagement,
 * avoiding the async flash where the name would briefly show "Unknown Mint".
 *
 * headerAmountLabel uses formatAmount with useUserPreference, which reads the
 * display setting imperatively. We subscribe to displayBtc reactively here so
 * switching between BTC/sats display updates the label without waiting for a
 * balance change.
 */

import { useMemo } from 'react';

import type { Mint } from 'coco-cashu-core';
import { formatAmount } from '@/shared/lib/currency';
import { getMintDisplayName } from '@/shared/lib/url';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

interface UseWalletHeaderStateArgs {
  selectedMint: string | undefined;
  balanceForMint: number;
  mints: Mint[];
}

export function useWalletHeaderState({
  selectedMint,
  balanceForMint,
  mints,
}: UseWalletHeaderStateArgs) {
  const displayBtc = useSettingsStore((s) => s.displayBtc);

  const selectedMintData = useMemo(
    () => (selectedMint ? mints.find((m) => m.mintUrl === selectedMint) : undefined),
    [mints, selectedMint]
  );

  const headerMintInfo = useMemo(() => {
    if (!selectedMintData) return null;
    const info = selectedMintData.mintInfo as any;
    return { name: info?.name || selectedMintData.name, icon_url: info?.icon_url } as {
      name?: string;
      icon_url?: string;
    };
  }, [selectedMintData]);

  const headerMintName = selectedMint
    ? getMintDisplayName(selectedMint, { name: headerMintInfo?.name })
    : 'Change Mint';

  const isLoading = Boolean(selectedMint && !selectedMintData);

  const headerAmountLabel = useMemo(
    () => formatAmount({ amount: balanceForMint, unit: 'sat' }, { useUserPreference: true }),
    [balanceForMint, displayBtc]
  );

  return {
    headerMintName,
    headerAmountLabel,
    headerMintInfo,
    isLoading,
  };
}
