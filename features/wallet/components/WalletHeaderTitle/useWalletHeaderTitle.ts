import { useCallback, useMemo } from 'react';
import { useWindowDimensions, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { getMintDisplayName } from '@/shared/lib/url';
import { useBalanceContext } from 'coco-cashu-react';
import { useMintManagement } from '@/features/mint';
import { useWalletHeaderState } from '@/features/wallet/hooks/useWalletHeaderState';
import { getContentWidthFromButtonWidth } from '@/features/wallet/lib/walletHeader';

export interface WalletHeaderTitleProps {
  width?: number;
  unit?: string;
  requireBalance?: boolean;
  onMintSelected?: (mint: { id: string; unit: string }) => void;
  showAddMintsButton?: boolean;
  showDetailsButton?: boolean;
  allowedMints?: string[];
  liquidGlass?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  style?: ViewStyle;
}

export interface TopMint {
  mintUrl: string;
  displayName: string;
  balance: number;
}

export interface WalletHeaderTitleShared {
  topMints: TopMint[];
  handleQuickSelectMint: (mintUrl: string) => void;
  handleShowAllMints: () => void;
  handleAddMint: () => void;
  dimensions: {
    buttonWidth: number | undefined;
    fallbackWidth: number;
    styleHeight: string | number | undefined;
    contentWidth: number;
    contentHeight: number;
  };
  mintDisplayProps: {
    unit: string;
    mintName: string | undefined;
    mintIconUrl: string | undefined;
    balance: number;
    isLoadingMint: boolean;
    contentWidth: number;
    contentHeight: number;
    linkHref: { pathname: '/list'; params: Record<string, string> };
  };
  showAddMintsButton: boolean;
  liquidGlass: boolean;
  style?: ViewStyle;
}

export function formatBalance(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M sats`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}k sats`;
  return `${amount} sats`;
}

export function useWalletHeaderTitle({
  width: explicitWidth,
  unit = 'sat',
  requireBalance = false,
  onMintSelected,
  showAddMintsButton = true,
  showDetailsButton = true,
  allowedMints,
  liquidGlass = false,
  contentWidth,
  contentHeight,
  style,
}: WalletHeaderTitleProps): WalletHeaderTitleShared {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const setSelectedMint = useMintStore((state) => state.setSelectedMint);

  const { mints, isLoading: isMintsLoading } = useMintManagement();
  const { balance: liveBalances } = useBalanceContext();

  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintUrl = pubkey ? selectedMints[pubkey] : undefined;
  const balanceForMint = selectedMintUrl ? liveBalances[selectedMintUrl] || 0 : 0;

  const header = useWalletHeaderState({
    selectedMint: selectedMintUrl,
    balanceForMint,
    mints,
    isMintsLoading,
  });

  const topMints = useMemo(() => {
    if (!mints || mints.length === 0) return [];

    const filteredMints = allowedMints?.length
      ? mints.filter((mint) => allowedMints.includes(mint.mintUrl))
      : mints;

    return filteredMints
      .map((mint) => ({
        ...mint,
        balance: liveBalances[mint.mintUrl] || 0,
        displayName: getMintDisplayName(mint.mintUrl, mint.mintInfo),
      }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3);
  }, [mints, liveBalances, allowedMints]);

  const handleQuickSelectMint = useCallback(
    (mintUrl: string) => {
      if (!pubkey) return;
      setSelectedMint(pubkey, mintUrl);
      onMintSelected?.({ id: mintUrl, unit });
    },
    [pubkey, setSelectedMint, onMintSelected, unit]
  );

  const handleShowAllMints = useCallback(() => {
    router.navigate({
      pathname: '/list',
      params: {
        requireBalance: 'false',
        showAddMintsButton: 'true',
        showDetailsButton: 'true',
        onSelectAction: 'goBack',
        ...(allowedMints && { allowedMints: JSON.stringify(allowedMints) }),
      },
    });
  }, [allowedMints]);

  const handleAddMint = useCallback(() => {
    router.navigate('/add');
  }, []);

  const { width: windowWidth } = useWindowDimensions();

  const dimensions = useMemo(() => {
    const styleWidth =
      style && typeof style === 'object' && 'width' in style ? style.width : undefined;
    const styleHeightValue =
      style && typeof style === 'object' && 'height' in style ? style.height : undefined;
    const styleHeight =
      typeof styleHeightValue === 'number' || typeof styleHeightValue === 'string'
        ? styleHeightValue
        : undefined;
    const buttonWidth =
      typeof styleWidth === 'number'
        ? styleWidth
        : typeof explicitWidth === 'number'
          ? explicitWidth
          : undefined;
    const fallbackWidth = buttonWidth ?? windowWidth - 124 - 16;
    const resolvedContentWidth =
      contentWidth ??
      getContentWidthFromButtonWidth(buttonWidth) ??
      getContentWidthFromButtonWidth(fallbackWidth)!;
    const resolvedContentHeight = contentHeight ?? 36;
    return {
      buttonWidth,
      fallbackWidth,
      styleHeight,
      contentWidth: resolvedContentWidth,
      contentHeight: resolvedContentHeight,
    };
  }, [style, explicitWidth, contentWidth, contentHeight, windowWidth]);

  const linkHref = useMemo(
    () => ({
      pathname: '/list' as const,
      params: {
        requireBalance: String(requireBalance),
        showAddMintsButton: String(showAddMintsButton),
        showDetailsButton: String(showDetailsButton),
        onSelectAction: 'goBack',
        ...(allowedMints && { allowedMints: JSON.stringify(allowedMints) }),
      },
    }),
    [requireBalance, showAddMintsButton, showDetailsButton, allowedMints]
  );

  const mintDisplayProps = {
    unit,
    mintName: header.headerMintInfo?.name || header.headerMintName,
    mintIconUrl: header.headerMintInfo?.icon_url,
    balance: balanceForMint,
    isLoadingMint: header.isLoading || !selectedMintUrl,
    contentWidth: dimensions.contentWidth,
    contentHeight: dimensions.contentHeight,
    linkHref,
  };

  return {
    topMints,
    handleQuickSelectMint,
    handleShowAllMints,
    handleAddMint,
    dimensions,
    mintDisplayProps,
    showAddMintsButton,
    liquidGlass,
    style,
  };
}
