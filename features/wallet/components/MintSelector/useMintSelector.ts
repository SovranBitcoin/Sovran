import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import type { MintAvailability } from 'coco-payment-ux';

import { useBalanceContext } from '@cashu/coco-react';

import { useMintManagement } from '@/features/mint';
import {
  getContentWidthFromButtonWidth,
  getHeaderTitleWidthFromWidth,
  HEADER_LAYOUT,
} from '@/features/wallet/lib/walletHeader';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { getMintDisplayName } from '@/shared/lib/url';
import { useMintStore } from '@/shared/stores/profile/mintStore';

export interface MintSelectorProps {
  /** Mint URL to display. When omitted, reads preferredMintUrl from store. */
  selectedMintUrl?: string;
  /** Called when user picks a mint from the quick-select dropdown. */
  onMintSelected: (mintUrl: string) => void;
  /** Called when user taps to open the full mint list. */
  onRequestMintList: () => void;
  /** Availability info from MintResolutionContext.trustedMints. Filters the dropdown. */
  trustedMints?: MintAvailability[];
  /** Unit for balance display. Default: 'sat'. */
  unit?: string;
  /** Override button width (e.g. 280 for quote screens). Otherwise auto-calculated from window. */
  width?: number;
}

export interface MintSelectorShared {
  mintUrl: string | undefined;
  mintName: string | undefined;
  mintIconUrl: string | undefined;
  balance: number;
  isLoading: boolean;
  unit: string;
  onRequestMintList: () => void;
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
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;

  const { mints, isLoading: isMintsLoading } = useMintManagement();
  const { balances: liveBalances } = useBalanceContext();

  const selectedMints = useMintStore((state) => state.selectedMints);
  const mintUrl = selectedMintUrl ?? (pubkey ? selectedMints[pubkey] : undefined);
  const balance = mintUrl ? liveBalances.byMint[mintUrl]?.total || 0 : 0;
  const mintData = useMemo(
    () => (mintUrl ? mints.find((m) => m.mintUrl === mintUrl) : undefined),
    [mints, mintUrl]
  );

  const mintInfo = useMemo(() => {
    if (!mintData) return null;
    const info = mintData.mintInfo as any;
    return { name: info?.name || mintData.name, icon_url: info?.icon_url } as {
      name?: string;
      icon_url?: string;
    };
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
