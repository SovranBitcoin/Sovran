import React, { useCallback, useMemo } from 'react';
import { useWindowDimensions, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import MintBalanceDisplay from '@/features/wallet/components/MintBalanceDisplay';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { Host, Button as SwiftUIButton, ContextMenu, HStack } from '@expo/ui/swift-ui';
import { buttonStyle, frame, padding, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { getMintDisplayName } from '@/shared/lib/url';
import { View } from '@/shared/ui/primitives/View/View';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { useBalanceContext } from 'coco-cashu-react';
import { useMintManagement } from '@/features/mint';
import { useWalletHeaderState } from '@/features/wallet/hooks/useWalletHeaderState';
import { getContentWidthFromButtonWidth } from '@/features/wallet/lib/walletHeader';

interface WalletHeaderTitleProps {
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
}

function formatBalance(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M sats`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}k sats`;
  return `${amount} sats`;
}

export default function WalletHeaderTitle({
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
}: WalletHeaderTitleProps & { style?: ViewStyle }) {
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
    const styleHeight =
      style && typeof style === 'object' && 'height' in style ? style.height : undefined;
    const buttonWidth =
      typeof styleWidth === 'number'
        ? styleWidth
        : typeof explicitWidth === 'number'
          ? explicitWidth
          : undefined;
    const resolvedContentWidth = contentWidth ?? getContentWidthFromButtonWidth(buttonWidth);
    const resolvedContentHeight = contentHeight ?? 36;
    return {
      buttonWidth,
      styleHeight,
      contentWidth: resolvedContentWidth,
      contentHeight: resolvedContentHeight,
    };
  }, [style, explicitWidth, contentWidth, contentHeight]);

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

  if (!supportsLiquidGlass()) {
    const headerWidth = windowWidth - 124 - 16;
    const fallbackWidth =
      typeof dimensions.buttonWidth === 'number' ? dimensions.buttonWidth : headerWidth;

    return (
      <View
        style={{
          width: fallbackWidth,
          alignSelf: 'center',
          alignItems: 'center',
          justifyContent: 'center',
          ...(style || {}),
        }}>
        <MintBalanceDisplay {...mintDisplayProps} style={{ width: '100%' }} />
      </View>
    );
  }

  const buttonModifiers = [
    buttonStyle('glass'),
    frame({ height: 50, width: dimensions.buttonWidth, alignment: 'center' }),
    ...(liquidGlass ? [] : [glassEffect({ shape: 'capsule' })]),
  ];

  return (
    <View
      style={{
        alignSelf: 'center',
        alignItems: 'center',
        justifyContent: 'center',
        width: dimensions.buttonWidth,
        height: typeof dimensions.styleHeight === 'number' ? dimensions.styleHeight : undefined,
        ...style,
      }}>
      <Host style={{ zIndex: 10, height: 50, width: dimensions.buttonWidth }} matchContents>
        <ContextMenu>
          <ContextMenu.Items>
            {topMints.map((mint) => (
              <SwiftUIButton
                key={mint.mintUrl}
                systemImage="building.columns"
                label={`${mint.displayName} (${formatBalance(mint.balance)})`}
                onPress={() => handleQuickSelectMint(mint.mintUrl)}
              />
            ))}
            <SwiftUIButton
              systemImage="list.bullet.rectangle"
              label="Show all mints"
              onPress={handleShowAllMints}
            />
            {showAddMintsButton && (
              <SwiftUIButton systemImage="plus.circle" label="Add Mint" onPress={handleAddMint} />
            )}
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <HStack
              modifiers={
                liquidGlass || typeof dimensions.buttonWidth === 'number'
                  ? []
                  : [padding({ horizontal: 64 })]
              }>
              <SwiftUIButton modifiers={buttonModifiers}>
                <MintBalanceDisplay {...mintDisplayProps} />
              </SwiftUIButton>
            </HStack>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
}
