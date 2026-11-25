import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { getMockMintBalance } from '@/shared/stores/runtime/mockDataStore';
import { useEffect, useMemo } from 'react';

import { useBalanceContext } from '@cashu/coco-react';

import { useMintManagement } from '@/features/mint';
import { getMintDisplayName } from '@/shared/lib/url';
import { amountToNumber } from 'wallet/amount';
import { toRealUnit } from 'wallet';
import { walletLog, mintUrlLogFields } from '@/shared/lib/logger';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useDefaultMintSetupStore } from '@/shared/stores/runtime/defaultMintSetupStore';

export interface MintSelectorProps {
  /** Stable identifier forwarded to the interactive platform pill. */
  testID?: string;
  /** Mint URL to display. When omitted, reads preferredMintUrl from store. */
  selectedMintUrl?: string;
  /** Called when user taps to open the full mint list. Omit to render a non-interactive pill. */
  onRequestMintList?: () => void;
  /** Unit for balance display. Default: 'sat'. */
  unit?: string;
  /** Override button width (e.g. 280 for quote screens). Otherwise auto-calculated from window. */
  width?: number;
  /** Override pill height. Defaults to the wallet-header pill height (54). */
  height?: number;
  /** Override inner content height. Pair with `height` when the pill is
   *  rendered smaller than the header default so the avatar + label row
   *  has visible padding inside the pill. */
  contentHeight?: number;
}

/**
 * - `pending`: no mint is selected yet, and the wallet may still pick one (its
 *   mints are loading, or this session's default-mint setup has not finished).
 * - `loading`: a mint is selected and its details have not arrived.
 * - `ready`: everything shown is real, including "no mint yet".
 */
type MintSelectorStatus = 'pending' | 'loading' | 'ready';

/** What the pill says once a wallet has settled with no mints at all. */
export const ADD_MINT_LABEL = 'Add a mint';

interface MintSelectorShared {
  mintUrl: string | undefined;
  mintName: string | undefined;
  mintIconUrl: string | undefined;
  balance: number;
  status: MintSelectorStatus;
  /** The pill shows its skeleton: `pending` or `loading`. */
  isLoading: boolean;
  /** Replaces the name and balance for a settled wallet with no mints. */
  ctaLabel: string | undefined;
  unit: string;
  onRequestMintList: (() => void) | undefined;
}

export function useMintSelector({
  selectedMintUrl,
  onRequestMintList,
  unit = 'sat',
}: MintSelectorProps): MintSelectorShared {
  const { mints, isLoading: isMintsLoading } = useMintManagement();
  const { balances: liveBalances } = useBalanceContext();

  const storedSelectedMint = useMintStore((state) => state.selectedMint);
  const mintUrl = selectedMintUrl ?? storedSelectedMint;
  const mockMode = useSettingsStore((state) => state.mockMode);
  const defaultMintsSettled = useDefaultMintSetupStore((state) => state.settled);
  const balance = mintUrl
    ? mockMode
      ? getMockMintBalance(mintUrl, unit)
      : amountToNumber(liveBalances.byMintAndUnit?.[mintUrl]?.[toRealUnit(unit)]?.total)
    : 0;
  const mintData = useMemo(
    () => (mintUrl ? mints.find((m) => m.mintUrl === mintUrl) : undefined),
    [mints, mintUrl]
  );

  const mintInfo = useMemo(() => {
    if (!mintData) return null;
    const info = mintData.mintInfo;
    return { name: info?.name || mintData.name, icon_url: info?.icon_url };
  }, [mintData]);

  const mintName = mintUrl ? getMintDisplayName(mintUrl, { name: mintInfo?.name }) : undefined;
  const mintIconUrl = mintInfo?.icon_url;
  const status = mintSelectorStatus({
    mintUrl,
    hasMintData: !!mintData,
    isMintsLoading,
    defaultMintsSettled,
  });
  const isLoading = status !== 'ready';
  const ctaLabel =
    status === 'ready' && !mintUrl && mints.length === 0 ? ADD_MINT_LABEL : undefined;

  useEffect(() => {
    walletLog.debug('mintSelector.state', {
      ...mintUrlLogFields(mintUrl),
      selectedFromProps: !!selectedMintUrl,
      hasStoredSelectedMint: !!storedSelectedMint,
      mintCount: mints.length,
      hasMintData: !!mintData,
      hasMintInfo: !!mintInfo,
      hasIcon: !!mintIconUrl,
      balance,
      unit,
      isMintsLoading,
      defaultMintsSettled,
      status,
      hasRequestMintList: !!onRequestMintList,
    });
  }, [
    balance,
    defaultMintsSettled,
    isMintsLoading,
    mintData,
    mintIconUrl,
    mintInfo,
    mintUrl,
    mints.length,
    onRequestMintList,
    selectedMintUrl,
    status,
    storedSelectedMint,
    unit,
  ]);

  return {
    mintUrl,
    mintName,
    mintIconUrl,
    balance,
    status,
    isLoading,
    ctaLabel,
    unit,
    onRequestMintList,
  };
}

/**
 * Which of the three states the pill is in. Pure, so the new-account path
 * (nothing selected while the default mint is still being added) is pinned
 * without a wallet.
 */
export function mintSelectorStatus({
  mintUrl,
  hasMintData,
  isMintsLoading,
  defaultMintsSettled,
}: {
  mintUrl: string | undefined;
  hasMintData: boolean;
  isMintsLoading: boolean;
  defaultMintsSettled: boolean;
}): MintSelectorStatus {
  if (!mintUrl) return isMintsLoading || !defaultMintsSettled ? 'pending' : 'ready';
  return !hasMintData && isMintsLoading ? 'loading' : 'ready';
}
