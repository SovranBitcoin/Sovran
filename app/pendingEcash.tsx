import React, { useMemo, useState, useCallback, useRef } from 'react';
import { StyleSheet, ScrollView, ActivityIndicator, View as RNView } from 'react-native';
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
  FadeInUp,
} from 'react-native-reanimated';
import { popup } from 'helper/popup';
import { useMints, usePaginatedHistory, useManager } from 'coco-cashu-react';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { PendingEcashCardFrame } from 'components/blocks/pending/PendingEcashCardFrame';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ============================================================================
// Header Components
// ============================================================================

// CloseButton is defined inline in the screen to access the hero context

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
  pendingTransactions: SendHistoryEntry[];
  totalAmount: number;
  unit: string;
  isLoading: boolean;
  onSweep: () => void;
}

const SweepButton = ({
  pendingTransactions,
  totalAmount,
  unit,
  isLoading,
  onSweep,
}: SweepButtonProps) => {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={styles.bottomContainer}>
      <LinearGradient
        colors={['transparent', opacity(getPrimaryColor('950'), 0.95), getPrimaryColor('950')]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onSweep}
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
          {isLoading
            ? 'Rolling back...'
            : `Rollback ${pendingTransactions.length} Pending (${totalAmount} ${unit.toUpperCase()})`}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ============================================================================
// Main Screen
// ============================================================================

export default function PendingEcashScreen() {
  const { getPrimaryColor, getGreenColor } = useTheme();
  const { history } = usePaginatedHistory();
  const { trustedMints: mints } = useMints();
  const manager = useManager();
  const hero = useHeroTransition();
  const insets = useSafeAreaInsets();
  const heroRef = useRef<any>(null);

  const accentColor = useMemo(() => getGreenColor('400'), [getGreenColor]);
  const topOffset = insets.top;

  // Scroll tracking for animated tabs
  const scrollY = useSharedValue(0);

  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(null);
  // Track which operation IDs are currently being rolled back
  const [rollingBackIds, setRollingBackIds] = useState<Set<string>>(new Set());
  const [isSweeping, setIsSweeping] = useState(false);

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

  const handleClose = useCallback(() => {
    hero.closePendingEcash();
  }, [hero]);

  const handleHeroLayout = useCallback(() => {
    hero.registerRef('pendingEcash', 'destination', heroRef.current);
  }, [hero]);

  const CloseButton = useCallback(
    () => (
      <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
        <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
      </TouchableOpacity>
    ),
    [getPrimaryColor, handleClose]
  );

  // Rollback all pending transactions for the selected mint
  const handleSweep = useCallback(async () => {
    if (isSweeping || displayedTransactions.length === 0) return;

    setIsSweeping(true);
    let successCount = 0;
    let failCount = 0;

    for (const tx of displayedTransactions) {
      // Add to rolling back set to show spinner
      setRollingBackIds((prev) => new Set(prev).add(tx.operationId));

      try {
        await manager.send.rollback(tx.operationId);
        successCount++;
      } catch (error) {
        console.error(`Failed to rollback ${tx.operationId}:`, error);
        failCount++;
      } finally {
        // Remove from rolling back set
        setRollingBackIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(tx.operationId);
          return newSet;
        });
      }
    }

    setIsSweeping(false);

    if (failCount === 0) {
      popup({
        message: `Successfully rolled back ${successCount} transaction${successCount !== 1 ? 's' : ''}`,
        type: 'success',
        emoji: '🎉',
        onClose: () => {
          router.back();
        },
      });
    } else {
      popup({
        message: `Rolled back ${successCount}, failed ${failCount}`,
        type: failCount === displayedTransactions.length ? 'error' : 'warning',
      });
    }
  }, [isSweeping, displayedTransactions, manager]);

  // Render sweep button only if there's a selected mint with pending transactions
  const sweepButton = useMemo(() => {
    if (!effectiveSelectedMint || displayedTransactions.length === 0) {
      return undefined;
    }
    return (
      <SweepButton
        pendingTransactions={displayedTransactions}
        totalAmount={totalPendingAmount}
        unit={totalUnit}
        isLoading={isSweeping}
        onSweep={handleSweep}
      />
    );
  }, [
    effectiveSelectedMint,
    displayedTransactions,
    totalPendingAmount,
    totalUnit,
    isSweeping,
    handleSweep,
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'card',
          animation: 'fade',
          headerShown: true,
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: '',
          headerBackVisible: false,
          headerTintColor: getPrimaryColor('0'),
          headerBlurEffect: 'none',
          headerBackground: () => null,
          headerLeft: CloseButton,
        }}
      />
      <ModalLayoutWrapper
        contentPadding={0}
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
        scrollY={scrollY}
        disableHeaderSpacer>
        {/* Hero card destination for shared-element transition */}
        <RNView
          ref={heroRef}
          onLayout={handleHeroLayout}
          collapsable={false}
          shouldRasterizeIOS
          renderToHardwareTextureAndroid
          style={[
            styles.heroCard,
            {
              borderColor: opacity(accentColor, 0.25),
              opacity: hero.isHidden('pendingEcash', 'destination') ? 0 : 1,
              marginTop: -topOffset,
              paddingTop: topOffset,
            },
          ]}>
          <PendingEcashCardFrame
            accentColor={accentColor}
            backgroundColor={getPrimaryColor('950')}
            highlightColor={getPrimaryColor('50')}>
            <VStack style={{ padding: 18, paddingTop: 18 + topOffset, zIndex: 1 }}>
              <HStack align="center" gap={10}>
                <View style={[styles.heroIcon, { backgroundColor: opacity(accentColor, 0.16) }]}>
                  <Icon name="mdi:clock-alert-outline" size={22} color={accentColor} />
                </View>
                <VStack>
                  <Text size={18} heavy style={{ color: getPrimaryColor('50') }}>
                    Pending Ecash
                  </Text>
                  <Text size={12} style={{ color: opacity(accentColor, 0.7) }}>
                    {pendingSends.length} unclaimed {pendingSends.length === 1 ? 'token' : 'tokens'}
                  </Text>
                </VStack>
              </HStack>
            </VStack>
          </PendingEcashCardFrame>
        </RNView>

        {/* Content below hero (fades in after transition) */}
        {!hero.isTransitioning('pendingEcash') ? (
          <Animated.View
            entering={FadeInUp.duration(220).delay(120)}
            style={{ paddingHorizontal: 16 }}>
            {/* Summary Card */}
            {displayedTransactions.length > 0 && (
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: opacity(getPrimaryColor('800'), 0.5) },
                ]}>
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
                  <Transaction
                    key={tx.id}
                    historyEntry={tx as HistoryEntry}
                    isLoading={rollingBackIds.has(tx.operationId)}
                  />
                ))}
              </View>
            )}
          </Animated.View>
        ) : null}
      </ModalLayoutWrapper>
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // Hero card destination
  heroCard: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    borderCurve: 'continuous',
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
    borderCurve: 'continuous',
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
