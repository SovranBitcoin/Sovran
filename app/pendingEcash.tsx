import React, { useMemo, useState, useCallback } from 'react';
import { StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { ModalLayoutWrapper } from './debugModal';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Avatar } from 'components/ui/Avatar';
import { Transaction } from 'components/blocks/Transaction';
import Icon from 'assets/icons';
import { SendHistoryEntry, HistoryEntry, Mint } from 'coco-cashu-core';
import { extractDomain } from 'helper/url';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import _ from 'lodash';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  SharedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { getEncodedTokenV4, Proof } from '@cashu/cashu-ts';
import { popup } from 'helper/popup';
import { useMints, usePaginatedHistory, useReceive } from 'coco-cashu-react';

// ============================================================================
// Header Components
// ============================================================================

const CloseButton = () => {
  const { getPrimaryColor } = useTheme();
  return (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );
};

// ============================================================================
// Animation Constants (matching MintCurrencyTabs)
// ============================================================================

const LARGE_ICON_SIZE = 28;
const SMALL_ICON_SIZE = 22;
const LARGE_FONT_SIZE = 14;
const SMALL_FONT_SIZE = 12;
const LARGE_PADDING_H = 14;
const SMALL_PADDING_H = 12;
const LARGE_PADDING_V = 10;
const SMALL_PADDING_V = 8;
const LARGE_GAP = 8;
const SMALL_GAP = 4;
const COLLAPSE_THRESHOLD = 50;

// ============================================================================
// Animated Mint Tab Component
// ============================================================================

interface AnimatedMintTabProps {
  mint: Mint;
  isSelected: boolean;
  pendingCount: number;
  onPress: () => void;
  scrollY?: SharedValue<number>;
  primaryColor0: string;
  primaryColor300: string;
  primaryColor700: string;
  primaryColor900: string;
}

function AnimatedMintTab({
  mint,
  isSelected,
  pendingCount,
  onPress,
  scrollY,
  primaryColor0,
  primaryColor300,
  primaryColor700,
  primaryColor900,
}: AnimatedMintTabProps) {
  const displayName = mint.mintInfo?.name || extractDomain(mint.mintUrl) || 'Unknown';

  // Animated container style
  const animatedContainerStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        paddingHorizontal: SMALL_PADDING_H,
        paddingVertical: SMALL_PADDING_V,
      };
    }

    const paddingH = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_PADDING_H, SMALL_PADDING_H],
      Extrapolation.CLAMP
    );
    const paddingV = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_PADDING_V, SMALL_PADDING_V],
      Extrapolation.CLAMP
    );

    return {
      paddingHorizontal: paddingH,
      paddingVertical: paddingV,
    };
  });

  // Animated icon container - animates size for layout + scale for smooth visuals
  const animatedIconStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        width: SMALL_ICON_SIZE,
        height: SMALL_ICON_SIZE,
        transform: [{ scale: SMALL_ICON_SIZE / LARGE_ICON_SIZE }],
      };
    }

    const size = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_ICON_SIZE, SMALL_ICON_SIZE],
      Extrapolation.CLAMP
    );

    const scale = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [1, SMALL_ICON_SIZE / LARGE_ICON_SIZE],
      Extrapolation.CLAMP
    );

    return {
      width: size,
      height: size,
      transform: [{ scale }],
    };
  });

  // Animated text style
  const animatedTextStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        fontSize: SMALL_FONT_SIZE,
      };
    }

    const fontSize = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_FONT_SIZE, SMALL_FONT_SIZE],
      Extrapolation.CLAMP
    );

    return {
      fontSize,
    };
  });

  // Animated gap style for the HStack
  const animatedGapStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        gap: SMALL_GAP,
      };
    }

    const gap = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_GAP, SMALL_GAP],
      Extrapolation.CLAMP
    );

    return {
      gap,
    };
  });

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Animated.View
        style={[
          styles.tabContainer,
          { backgroundColor: isSelected ? primaryColor700 : primaryColor900 },
          animatedContainerStyle,
        ]}>
        <Animated.View style={[styles.tabContent, animatedGapStyle]}>
          <Animated.View style={[styles.iconContainer, animatedIconStyle]}>
            <Avatar
              picture={mint.mintInfo?.icon_url || undefined}
              size={LARGE_ICON_SIZE}
              variant="mint"
              name={displayName}
              alt={`${displayName} icon`}
            />
          </Animated.View>
          <VStack>
            <Animated.Text
              style={[styles.tabText, { color: primaryColor0 }, animatedTextStyle]}
              numberOfLines={1}>
              {displayName}
            </Animated.Text>
            <Text size={10} style={{ color: primaryColor300 }}>
              {pendingCount} pending
            </Text>
          </VStack>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ============================================================================
// Mint Tabs Component (similar to MintCurrencyTabs)
// ============================================================================

interface MintTabsProps {
  mints: Mint[];
  selectedMintUrl: string | null;
  onMintChange: (mintUrl: string) => void;
  pendingByMint: Record<string, SendHistoryEntry[]>;
  scrollY?: SharedValue<number>;
}

const STICKY_HEIGHT = 56;

function MintTabs({ mints, selectedMintUrl, onMintChange, pendingByMint, scrollY }: MintTabsProps) {
  const { getPrimaryColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor300 = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);

  // Filter to only show mints that have pending transactions
  const mintsWithPending = useMemo(
    () => mints.filter((mint) => (pendingByMint[mint.mintUrl]?.length || 0) > 0),
    [mints, pendingByMint]
  );

  // Animated gap between items
  const animatedListGapStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        gap: 6,
      };
    }

    const gap = interpolate(scrollY.value, [0, COLLAPSE_THRESHOLD], [10, 6], Extrapolation.CLAMP);

    return {
      gap,
    };
  });

  if (mintsWithPending.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}>
      <Animated.View style={[styles.tabList, animatedListGapStyle]}>
        {mintsWithPending.map((mint) => {
          const pendingCount = pendingByMint[mint.mintUrl]?.length || 0;

          return (
            <AnimatedMintTab
              key={mint.mintUrl}
              mint={mint}
              isSelected={selectedMintUrl === mint.mintUrl}
              pendingCount={pendingCount}
              onPress={() => onMintChange(mint.mintUrl)}
              scrollY={scrollY}
              primaryColor0={primaryColor0}
              primaryColor300={primaryColor300}
              primaryColor700={primaryColor700}
              primaryColor900={primaryColor900}
            />
          );
        })}
      </Animated.View>
    </ScrollView>
  );
}

// ============================================================================
// Bottom Sweep Button
// ============================================================================

interface SweepButtonProps {
  mintUrl: string;
  pendingTransactions: SendHistoryEntry[];
  unit: string;
  totalAmount: number;
  onSweepComplete: () => void;
}

const SweepButton = ({
  mintUrl,
  pendingTransactions,
  unit,
  totalAmount,
  onSweepComplete,
}: SweepButtonProps) => {
  const { getPrimaryColor } = useTheme();
  const { receive } = useReceive();
  const [isLoading, setIsLoading] = useState(false);

  const handleSweep = useCallback(async () => {
    if (isLoading || pendingTransactions.length === 0) return;

    setIsLoading(true);
    try {
      // Extract all proofs from pending transactions
      const allProofs: Proof[] = [];

      for (const tx of pendingTransactions) {
        if (tx.token && tx.token.proofs) {
          allProofs.push(...tx.token.proofs);
        }
      }

      if (allProofs.length === 0) {
        popup({
          message: 'No proofs found in pending transactions',
          type: 'error',
        });
        setIsLoading(false);
        return;
      }

      // Create a combined token with all proofs
      const combinedToken = getEncodedTokenV4({
        mint: mintUrl,
        proofs: allProofs,
        unit: unit,
      });

      // Redeem the combined token
      await receive(combinedToken);

      // Show success popup
      popup({
        message: 'funds_received',
        params: { amount: totalAmount, unit },
        emoji: '🎉',
        onClose: () => {
          onSweepComplete();
          router.back();
        },
      });
    } catch (error) {
      console.error('Sweep failed:', error);
      popup({
        message: error instanceof Error ? error.message : 'Failed to sweep pending ecash',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, pendingTransactions, mintUrl, unit, totalAmount, receive, onSweepComplete]);

  return (
    <View style={styles.bottomContainer}>
      <LinearGradient
        colors={['transparent', opacity(getPrimaryColor('950'), 0.95), getPrimaryColor('950')]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={handleSweep}
        disabled={isLoading || pendingTransactions.length === 0}
        style={[
          styles.sweepButton,
          {
            backgroundColor: isLoading ? getPrimaryColor('700') : getPrimaryColor('500'),
            opacity: pendingTransactions.length === 0 ? 0.5 : 1,
          },
        ]}>
        {isLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Icon name="mdi:broom" size={20} color="#fff" />
        )}
        <Text size={16} heavy style={{ color: '#fff', marginLeft: 8 }}>
          {isLoading ? 'Sweeping...' : `Sweep ${pendingTransactions.length} Pending`}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================================
// Main Screen
// ============================================================================

export default function PendingEcashScreen() {
  const { getPrimaryColor } = useTheme();
  const { history } = usePaginatedHistory();
  const { trustedMints: mints } = useMints();

  // Scroll tracking for animated tabs
  const scrollY = useSharedValue(0);

  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(null);

  // Filter pending send transactions
  const pendingSends = useMemo(() => {
    return history.filter(
      (entry): entry is SendHistoryEntry =>
        entry.type === 'send' && (entry.state === 'pending' || entry.state === 'prepared')
    );
  }, [history]);

  // Group by mint URL
  const pendingByMint = useMemo(() => {
    return _.groupBy(pendingSends, 'mintUrl');
  }, [pendingSends]);

  // Get mints that have pending transactions
  const mintsWithPending = useMemo(
    () => mints.filter((mint) => (pendingByMint[mint.mintUrl]?.length || 0) > 0),
    [mints, pendingByMint]
  );

  // Auto-select first mint if none selected and there are pending transactions
  const effectiveSelectedMint = useMemo(() => {
    if (selectedMintUrl && pendingByMint[selectedMintUrl]) {
      return selectedMintUrl;
    }
    // Auto-select the first mint with pending transactions
    return mintsWithPending[0]?.mintUrl || null;
  }, [selectedMintUrl, pendingByMint, mintsWithPending]);

  // Get transactions to display based on selection
  const displayedTransactions = useMemo(() => {
    if (!effectiveSelectedMint) {
      return [];
    }
    return pendingByMint[effectiveSelectedMint] || [];
  }, [effectiveSelectedMint, pendingByMint]);

  // Calculate total pending amount for selected mint
  const totalPendingAmount = useMemo(() => {
    return displayedTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  }, [displayedTransactions]);

  const totalUnit = displayedTransactions[0]?.unit || 'sat';

  // Get selected mint info for display
  const selectedMintInfo = useMemo(() => {
    return mints.find((m) => m.mintUrl === effectiveSelectedMint);
  }, [mints, effectiveSelectedMint]);

  // Callback when sweep is complete - could trigger a refresh
  const handleSweepComplete = useCallback(() => {
    // History will auto-update via coco events
  }, []);

  // Render sweep button only if there's a selected mint with pending transactions
  const sweepButton = useMemo(() => {
    if (!effectiveSelectedMint || displayedTransactions.length === 0) {
      return undefined;
    }
    return (
      <SweepButton
        mintUrl={effectiveSelectedMint}
        pendingTransactions={displayedTransactions}
        unit={totalUnit}
        totalAmount={totalPendingAmount}
        onSweepComplete={handleSweepComplete}
      />
    );
  }, [
    effectiveSelectedMint,
    displayedTransactions,
    totalUnit,
    totalPendingAmount,
    handleSweepComplete,
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: 'Pending Ecash',
          headerLeft: () => <CloseButton />,
          headerTintColor: getPrimaryColor('0'),
        }}
      />
      <ModalLayoutWrapper
        headerGradient
        stickyContent={
          <MintTabs
            mints={mints}
            selectedMintUrl={effectiveSelectedMint}
            onMintChange={setSelectedMintUrl}
            pendingByMint={pendingByMint}
            scrollY={scrollY}
          />
        }
        stickyContentHeight={STICKY_HEIGHT}
        bottomContent={sweepButton}
        bottomPadding={displayedTransactions.length > 0 ? 160 : 120}
        useAnimatedScroll
        scrollY={scrollY}>
        {/* Summary Card */}
        {displayedTransactions.length > 0 && (
          <View
            style={[styles.summaryCard, { backgroundColor: opacity(getPrimaryColor('800'), 0.5) }]}>
            <HStack align="center" justify="space-between">
              <VStack>
                <HStack align="center" gap={8}>
                  {selectedMintInfo && (
                    <Avatar
                      picture={selectedMintInfo.mintInfo?.icon_url || undefined}
                      size={20}
                      variant="mint"
                      name={
                        selectedMintInfo.mintInfo?.name ||
                        extractDomain(selectedMintInfo.mintUrl) ||
                        'Unknown'
                      }
                    />
                  )}
                  <Text size={12} style={{ color: getPrimaryColor('400') }}>
                    {selectedMintInfo?.mintInfo?.name ||
                      extractDomain(effectiveSelectedMint || '') ||
                      'Pending'}
                  </Text>
                </HStack>
                <AmountFormatter
                  amount={totalPendingAmount}
                  unit={totalUnit}
                  size={24}
                  weight="heavy"
                  color={getPrimaryColor('50')}
                />
              </VStack>
              <View
                style={[
                  styles.pendingBadge,
                  { backgroundColor: opacity(getPrimaryColor('500'), 0.2) },
                ]}>
                <Icon name="mdi:clock-outline" size={16} color={getPrimaryColor('400')} />
                <Text size={12} heavy style={{ color: getPrimaryColor('300'), marginLeft: 4 }}>
                  {displayedTransactions.length} pending
                </Text>
              </View>
            </HStack>
          </View>
        )}

        <Spacer size={16} />

        {/* Transaction List */}
        {displayedTransactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="mdi:check-circle-outline" size={48} color={getPrimaryColor('500')} />
            <Spacer size={12} />
            <Text size={18} heavy style={{ color: getPrimaryColor('100') }}>
              No Pending Ecash
            </Text>
            <Text
              size={14}
              style={{ color: getPrimaryColor('400'), textAlign: 'center', marginTop: 4 }}>
              All your sent ecash has been claimed
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.transactionList,
              { backgroundColor: opacity(getPrimaryColor('800'), 0.3) },
            ]}>
            {displayedTransactions.map((tx) => (
              <Transaction key={tx.id} historyEntry={tx as HistoryEntry} />
            ))}
          </View>
        )}
      </ModalLayoutWrapper>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // Tab styles (matching MintCurrencyTabs)
  scrollView: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scrollContent: {
    alignItems: 'center',
  },
  tabList: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabContainer: {
    borderRadius: 16,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontFamily: 'OverpassBold',
    maxWidth: 100,
  },
  // Other styles
  summaryCard: {
    borderRadius: 16,
    padding: 16,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  transactionList: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 20,
  },
  sweepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
  },
});
