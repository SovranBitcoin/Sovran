import React, { useCallback, useMemo } from 'react';
import { useWindowDimensions, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useMintManagement, useBalanceContext } from 'hooks/coco';
import { Host, Button as SwiftUIButton, ContextMenu, HStack } from '@expo/ui/swift-ui';
import { frame, padding } from '@expo/ui/swift-ui/modifiers';
import { getMintDisplayName } from 'helper/url';
import { View } from 'components/ui/View';

interface WalletHeaderTitleProps {
  /** Custom width (defaults to header width calculation) */
  width?: number;
  /** Unit for balance display */
  unit?: string;
  /** Whether balance is required for mint selection */
  requireBalance?: boolean;
  /** Callback when a mint is selected */
  onMintSelected?: (mint: { id: string; unit: string }) => void;
}

/**
 * A self-contained mint selector component with glass effect and context menu.
 * Can be used as a header title or standalone in other screens.
 */
export default function WalletHeaderTitle({
  width,
  unit = 'sat',
  requireBalance = false,
  onMintSelected,
  style,
}: WalletHeaderTitleProps & { style?: ViewStyle }) {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const setSelectedMint = useMintStore((state) => state.setSelectedMint);

  // Get mints and balances for quick selection
  const { mints } = useMintManagement();
  const { balance: liveBalances } = useBalanceContext();

  // Get top 3 mints sorted by balance
  const topMints = useMemo(() => {
    if (!mints || mints.length === 0) return [];

    const mintsWithBalances = mints.map((mint) => ({
      ...mint,
      balance: liveBalances[mint.mintUrl] || 0,
      displayName: getMintDisplayName(mint.mintUrl, mint.mintInfo),
    }));

    return mintsWithBalances.sort((a, b) => b.balance - a.balance).slice(0, 3);
  }, [mints, liveBalances]);

  const handleMintSelectedInternal = useCallback(
    async (mint: { id: string; unit: string }) => {
      if (!pubkey) {
        if (__DEV__) {
          console.warn('WalletHeaderTitle: No pubkey available, cannot set selected mint');
        }
        return;
      }
      setSelectedMint(pubkey, mint.id);
      // Call external callback if provided
      onMintSelected?.(mint);
    },
    [pubkey, setSelectedMint, onMintSelected]
  );

  const handleQuickSelectMint = useCallback(
    (mintUrl: string) => {
      if (!pubkey) return;
      setSelectedMint(pubkey, mintUrl);
    },
    [pubkey, setSelectedMint]
  );

  const handleShowAllMints = useCallback(() => {
    router.push({
      pathname: '/list',
      params: {
        requireBalance: 'false',
        showAddMintsButton: 'true',
        showDetailsButton: 'true',
        onSelectAction: 'goBack',
      },
    });
  }, []);

  const handleAddMint = useCallback(() => {
    router.push('/add');
  }, []);

  // Calculate width - use provided width or default header width calculation
  const { width: windowWidth } = useWindowDimensions();

  // Header buttons are ~44px each (icon + touch target), plus ~16px padding on each side
  // Total horizontal space taken: 2 * (44 + 16) = 120px
  // Add some breathing room for visual balance: 24px
  const defaultHeaderWidth = windowWidth;
  const componentWidth = width ?? defaultHeaderWidth;

  // Format balance for display
  const formatBalance = (amount: number) => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1)}M sats`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}k sats`;
    }
    return `${amount} sats`;
  };

  return (
    <View
      style={{
        alignItems: 'center',
        width: '100%',
        ...style,
      }}>
      <Host style={{ zIndex: 10, height: 50, width: '100%' }} matchContents fixedSize={true}>
        <ContextMenu activationMethod="longPress">
          <ContextMenu.Items>
            {/* Quick Mint Selection - Top 3 mints */}
            {topMints.map((mint) => (
              <SwiftUIButton
                key={mint.mintUrl}
                systemImage="building.columns"
                onPress={() => handleQuickSelectMint(mint.mintUrl)}>
                {`${mint.displayName} (${formatBalance(mint.balance)})`}
              </SwiftUIButton>
            ))}

            {/* Show All Mints */}
            <SwiftUIButton systemImage="list.bullet.rectangle" onPress={handleShowAllMints}>
              Show all mints
            </SwiftUIButton>

            {/* Actions */}
            <SwiftUIButton systemImage="plus.circle" onPress={handleAddMint}>
              Add Mint
            </SwiftUIButton>
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <HStack modifiers={[padding({ horizontal: 64 })]}>
              <SwiftUIButton
                variant="glass"
                modifiers={[frame({ height: 50, alignment: 'center' })]}>
                <MintBalanceDisplay
                  unit={unit}
                  onMintSelected={handleMintSelectedInternal}
                  requireBalance={requireBalance}
                  updateSelectedMint={true}
                  showAddMintsButton={true}
                  showDetailsButton={true}
                  style={{ width: '100%' }}
                />
              </SwiftUIButton>
            </HStack>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
}
