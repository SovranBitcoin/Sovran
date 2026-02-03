import React, { useCallback, useMemo } from 'react';
import { useWindowDimensions, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Host, Button as SwiftUIButton, ContextMenu, HStack } from '@expo/ui/swift-ui';
import { buttonStyle, frame, padding, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { getMintDisplayName } from 'helper/url';
import { View } from 'components/ui/View/View';
import { supportsLiquidGlass } from '@/helper/version';
import { useBalanceContext } from 'coco-cashu-react';
import { useMintManagement } from '@/hooks/coco/useMintManagement';

interface WalletHeaderTitleProps {
  /** Custom width (defaults to header width calculation) */
  width?: number;
  /** Unit for balance display */
  unit?: string;
  /** Whether balance is required for mint selection */
  requireBalance?: boolean;
  /** Callback when a mint is selected */
  onMintSelected?: (mint: { id: string; unit: string }) => void;
  /** Whether to show the add mints button in the mint list (default: true) */
  showAddMintsButton?: boolean;
  /** Whether to show the details/inspect button on each mint (default: true) */
  showDetailsButton?: boolean;
  /** Allowed mint URLs for filtering (payment request mints) */
  allowedMints?: string[];
  /** Whether being used with Liquid Glass Stack.Toolbar (auto width) */
  liquidGlass?: boolean;
  /** Inner content width (after subtracting button padding) */
  contentWidth?: number;
  /** Inner content height (after subtracting button padding) */
  contentHeight?: number;
}

/**
 * A self-contained mint selector component with glass effect and context menu.
 * Can be used as a header title or standalone in other screens.
 */
export default function WalletHeaderTitle({
  width: _width,
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

  // Get mints and balances for quick selection
  const { mints } = useMintManagement();
  const { balance: liveBalances } = useBalanceContext();

  // Get top 3 mints sorted by balance (filtered by allowedMints if provided)
  const topMints = useMemo(() => {
    if (!mints || mints.length === 0) return [];

    // Filter by allowed mints if specified
    const filteredMints = allowedMints?.length
      ? mints.filter((mint) => allowedMints.includes(mint.mintUrl))
      : mints;

    const mintsWithBalances = filteredMints.map((mint) => ({
      ...mint,
      balance: liveBalances[mint.mintUrl] || 0,
      displayName: getMintDisplayName(mint.mintUrl, mint.mintInfo),
    }));

    return mintsWithBalances.sort((a, b) => b.balance - a.balance).slice(0, 3);
  }, [mints, liveBalances, allowedMints]);

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
        ...(allowedMints && { allowedMints: JSON.stringify(allowedMints) }),
      },
    });
  }, [allowedMints]);

  const handleAddMint = useCallback(() => {
    router.push('/add');
  }, []);

  // Get window dimensions for width calculations
  const { width: windowWidth } = useWindowDimensions();

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

  // Blur fallback for older devices (pre-liquid glass)
  if (!supportsLiquidGlass()) {
    // Calculate width to fit between header buttons
    const _headerWidth = windowWidth - 124 - 16;

    return (
      // <View
      //   className="pointer-events-box-none"
      //   style={{
      //     width: _headerWidth,
      //     alignItems: 'center',
      //   }}>
      <MintBalanceDisplay
        unit={unit}
        onMintSelected={handleMintSelectedInternal}
        requireBalance={requireBalance}
        updateSelectedMint={true}
        showAddMintsButton={showAddMintsButton}
        showDetailsButton={showDetailsButton}
        allowedMints={allowedMints}
        style={{ width: '100%' }}
      />
      // </View>
    );
  }

  // Extract width from style prop for SwiftUI frame
  const styleWidth =
    style && typeof style === 'object' && 'width' in style ? style.width : undefined;
  const buttonWidth = typeof styleWidth === 'number' ? styleWidth : undefined;

  // Liquid Glass UI (iOS 26+, iPadOS 26+, macOS 26+)
  // When liquidGlass=true, use glass button with capsule shape for native Liquid Glass effect
  // When liquidGlass=false (standard header), use glass button styling with explicit effect
  const buttonModifiers = liquidGlass
    ? [
        buttonStyle('glass'),
        frame({ height: 50, width: buttonWidth, alignment: 'center' }),
        glassEffect({ shape: 'capsule' }),
      ]
    : [
        buttonStyle('glass'),
        frame({ height: 50, alignment: 'center' }),
        glassEffect({ shape: 'capsule' }),
      ];

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        width: buttonWidth,
        ...style,
      }}>
      <Host style={{ zIndex: 10, height: 50, width: buttonWidth }} matchContents>
        <ContextMenu>
          <ContextMenu.Items>
            {/* Quick Mint Selection - Top 3 mints */}
            {topMints.map((mint) => (
              <SwiftUIButton
                key={mint.mintUrl}
                systemImage="building.columns"
                label={`${mint.displayName} (${formatBalance(mint.balance)})`}
                onPress={() => handleQuickSelectMint(mint.mintUrl)}
              />
            ))}

            {/* Show All Mints */}
            <SwiftUIButton
              systemImage="list.bullet.rectangle"
              label="Show all mints"
              onPress={handleShowAllMints}
            />

            {/* Actions */}
            {showAddMintsButton && (
              <SwiftUIButton systemImage="plus.circle" label="Add Mint" onPress={handleAddMint} />
            )}
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <HStack modifiers={liquidGlass ? [] : [padding({ horizontal: 64 })]}>
              <SwiftUIButton modifiers={buttonModifiers}>
                <MintBalanceDisplay
                  unit={unit}
                  onMintSelected={handleMintSelectedInternal}
                  requireBalance={requireBalance}
                  updateSelectedMint={true}
                  showAddMintsButton={showAddMintsButton}
                  showDetailsButton={showDetailsButton}
                  allowedMints={allowedMints}
                  contentWidth={contentWidth}
                  contentHeight={contentHeight}
                />
              </SwiftUIButton>
            </HStack>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
}
