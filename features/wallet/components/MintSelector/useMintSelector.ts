import { useEffect, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import type { MintAvailability } from '@sovranbitcoin/colada';

import { useBalanceContext } from '@cashu/coco-react';

import { useMintManagement } from '@/features/mint';
import {
  getContentWidthFromButtonWidth,
  getHeaderTitleWidthFromWidth,
  HEADER_LAYOUT,
} from '@/features/wallet/lib/walletHeader';
import { getMintDisplayName } from '@/shared/lib/url';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { walletLog } from '@/shared/lib/logger';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { mintUrlLogFields } from '@/shared/lib/mintUrlLog';

export interface MintSelectorProps {
  /** Mint URL to display. When omitted, reads preferredMintUrl from store. */
  selectedMintUrl?: string;
  /** Called when user taps to open the full mint list. Omit to render a non-interactive pill. */
  onRequestMintList?: () => void;
  /** Availability info per trusted mint. Filters the dropdown. */
  trustedMints?: MintAvailability[];
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

interface MintSelectorShared {
  mintUrl: string | undefined;
  mintName: string | undefined;
  mintIconUrl: string | undefined;
  balance: number;
  isLoading: boolean;
  unit: string;
  onRequestMintList: (() => void) | undefined;
  dimensions: {
    buttonWidth: number;
    contentWidth: number;
    contentHeight: number;
  };
}

export function useMintSelector({
  selectedMintUrl,
  onRequestMintList,
  unit = 'sat',
  width,
}: MintSelectorProps): MintSelectorShared {
  const { mints, isLoading: isMintsLoading } = useMintManagement();
  const { balances: liveBalances } = useBalanceContext();

  const storedSelectedMint = useMintStore((state) => state.selectedMint);
  const mintUrl = selectedMintUrl ?? storedSelectedMint;
  const balance = mintUrl ? amountToNumber(liveBalances.byMint[mintUrl]?.total) : 0;
  const mintData = mintUrl ? mints.find((m) => m.mintUrl === mintUrl) : undefined;

  const mintInfo = useMemo(() => {
    if (!mintData) return null;
    const info = mintData.mintInfo;
    return { name: info?.name || mintData.name, icon_url: info?.icon_url };
  }, [mintData]);

  const mintName = mintUrl ? getMintDisplayName(mintUrl, { name: mintInfo?.name }) : undefined;
  const mintIconUrl = mintInfo?.icon_url;
  // Only show skeleton when we have a selected mint but its data hasn't loaded yet.
  // Don't show skeleton when no mint is selected (fresh install) or mints are still loading
  // with no selection — in those cases the component shows a "Select Mint" placeholder.
  const isLoading = Boolean(mintUrl && !mintData && isMintsLoading);

  const { width: windowWidth } = useWindowDimensions();

  const dimensions = useMemo(() => {
    const buttonWidth = width ?? getHeaderTitleWidthFromWidth(windowWidth);
    const contentWidth = getContentWidthFromButtonWidth(buttonWidth) ?? buttonWidth;
    const contentHeight = HEADER_LAYOUT.BUTTON_HEIGHT - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;
    return { buttonWidth, contentWidth, contentHeight };
  }, [width, windowWidth]);

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
      isLoading,
      hasRequestMintList: !!onRequestMintList,
      buttonWidth: dimensions.buttonWidth,
      contentWidth: dimensions.contentWidth,
    });
  }, [
    balance,
    dimensions.buttonWidth,
    dimensions.contentWidth,
    isLoading,
    isMintsLoading,
    mintData,
    mintIconUrl,
    mintInfo,
    mintUrl,
    mints.length,
    onRequestMintList,
    selectedMintUrl,
    storedSelectedMint,
    unit,
  ]);

  return {
    mintUrl,
    mintName,
    mintIconUrl,
    balance,
    isLoading,
    unit,
    onRequestMintList,
    dimensions,
  };
}
