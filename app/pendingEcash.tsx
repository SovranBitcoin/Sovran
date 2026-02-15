import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, ScrollView, View as RNView, useWindowDimensions } from 'react-native';
import PagerView from 'react-native-pager-view';
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
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import _ from 'lodash';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  SharedValue,
  useSharedValue,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { popup } from 'helper/popup';
import { useMints, usePaginatedHistory, useManager } from 'coco-cashu-react';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { PendingEcashCardFrame } from 'components/blocks/pending/PendingEcashCardFrame';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';

// ============================================================================
// Header Components
// ============================================================================

// CloseButton is defined inline in the screen to access the hero context

// ============================================================================
// Animation Constants (matching MintCurrencyTabs)
// ============================================================================

const LARGE_ICON_SIZE = 28;
const LARGE_FONT_SIZE = 14;
const LARGE_PADDING_H = 14;
const LARGE_PADDING_V = 10;
const LARGE_GAP = 8;
const COLLAPSE_THRESHOLD = 50;
const HEADER_OVERLAP = 24; // content overlaps sticky header for gradient fade

// ============================================================================
// Animated Mint Tab Component
// ============================================================================

interface AnimatedMintTabProps {
  mint: Mint;
  isSelected: boolean;
  pendingCount: number;
  totalAmount: number;
  unit: string;
  onPress: () => void;
  primaryColor0: string;
  primaryColor300: string;
  primaryColor700: string;
  primaryColor900: string;
}

function AnimatedMintTab({
  mint,
  isSelected,
  pendingCount,
  totalAmount,
  unit,
  onPress,
  primaryColor0,
  primaryColor300,
  primaryColor700,
  primaryColor900,
}: AnimatedMintTabProps) {
  const displayName = mint.mintInfo?.name || extractDomain(mint.mintUrl) || 'Unknown';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <View
        style={[
          styles.tabContainer,
          {
            backgroundColor: isSelected ? primaryColor700 : primaryColor900,
            paddingHorizontal: LARGE_PADDING_H,
            paddingVertical: LARGE_PADDING_V,
          },
        ]}>
        <View style={[styles.tabContent, { gap: LARGE_GAP }]}>
          <View style={styles.iconContainer}>
            <Avatar
              picture={mint.mintInfo?.icon_url || undefined}
              size={LARGE_ICON_SIZE}
              variant="mint"
              name={displayName}
              alt={`${displayName} icon`}
            />
          </View>
          <VStack>
            <Animated.Text
              style={[styles.tabText, { color: primaryColor0, fontSize: LARGE_FONT_SIZE }]}
              numberOfLines={1}>
              {displayName}
            </Animated.Text>
            <HStack align="center" gap={2}>
              <AmountFormatter
                amount={totalAmount}
                unit={unit}
                size={10}
                weight="heavy"
                color={primaryColor300}
              />
              <Text size={10} style={{ color: primaryColor300 }}>
                • {pendingCount} pending
              </Text>
            </HStack>
          </VStack>
        </View>
      </View>
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

function MintTabs({ mints, selectedMintUrl, onMintChange, pendingByMint, scrollY }: MintTabsProps) {
  const { getPrimaryColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor300 = useMemo(() => opacity(getPrimaryColor('0'), 0.5), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);

  // Filter to only show mints that have pending transactions
  const mintsWithPending = useMemo(
    () => mints.filter((mint) => (pendingByMint[mint.mintUrl]?.length || 0) > 0),
    [mints, pendingByMint]
  );

  // GPU-accelerated scale on the entire tab row (Rule 3.1: transform instead of layout props)
  const animatedRowScale = useAnimatedStyle(() => {
    if (!scrollY) return {};
    const scale = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [1, 0.85],
      Extrapolation.CLAMP
    );
    return { transform: [{ scale }] };
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
      <Animated.View
        style={[styles.tabList, { gap: 10, transformOrigin: 'left center' }, animatedRowScale]}>
        {mintsWithPending.map((mint) => {
          const pendingItems = pendingByMint[mint.mintUrl] || [];
          const pendingCount = pendingItems.length;
          const totalAmount = pendingItems.reduce((sum, tx) => sum + tx.amount, 0);
          const unit = pendingItems[0]?.unit || 'sat';

          return (
            <AnimatedMintTab
              key={mint.mintUrl}
              mint={mint}
              isSelected={selectedMintUrl === mint.mintUrl}
              pendingCount={pendingCount}
              totalAmount={totalAmount}
              unit={unit}
              onPress={() => onMintChange(mint.mintUrl)}
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
// Main Screen
// ============================================================================

export default function PendingEcashScreen() {
  const { getPrimaryColor, getGreenColor } = useTheme();
  const { history } = usePaginatedHistory();
  const { trustedMints: mints } = useMints();
  const manager = useManager();
  const hero = useHeroTransition();
  const insets = useSafeAreaInsets();
  const nativeHeaderHeight = useHeaderHeight();
  const heroRef = useRef<any>(null);
  const pagerRef = useRef<PagerView>(null);
  const { height: windowHeight } = useWindowDimensions();

  const accentColor = useMemo(() => getGreenColor('400'), [getGreenColor]);
  const topOffset = insets.top;

  // Scroll tracking for animated tabs
  const scrollY = useSharedValue(0);

  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(null);
  // Track which operation IDs are currently being rolled back
  const [rollingBackIds, setRollingBackIds] = useState<Set<string>>(new Set());
  const [isSweeping, setIsSweeping] = useState(false);

  // Measured height of the sticky header (hero + tabs + gradient) for scroll spacer
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(250);
  const handleStickyLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      setStickyHeaderHeight(event.nativeEvent.layout.height);
    },
    []
  );

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

  // Card colors for transaction list (matching Transactions.tsx pattern)
  const cardAccentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const cardBorderColor = useMemo(() => opacity(cardAccentColor, 0.3), [cardAccentColor]);

  // PagerView height: fill remaining screen below hero + tabs
  const pagerHeight = windowHeight * 0.6;

  // Handle mint tab press → update state + animate pager
  const handleMintChange = useCallback(
    (mintUrl: string) => {
      setSelectedMintUrl(mintUrl);
      const index = mintsWithPending.findIndex((m) => m.mintUrl === mintUrl);
      if (index >= 0) {
        pagerRef.current?.setPage(index);
      }
    },
    [mintsWithPending]
  );

  // Handle pager swipe → update selected tab
  const onPageSelected = useCallback(
    (event: { nativeEvent: { position: number } }) => {
      const pageIndex = event.nativeEvent.position;
      if (mintsWithPending[pageIndex]) {
        setSelectedMintUrl(mintsWithPending[pageIndex].mintUrl);
      }
    },
    [mintsWithPending]
  );

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

  // ---------------------------------------------------------------------------
  // Safe fade-in animations (always mounted, no mount/unmount race with Core Animation)
  // ---------------------------------------------------------------------------
  const isHeroTransitioning = hero.isTransitioning('pendingEcash');

  const tabsOpacity = useSharedValue(0);
  const tabsTranslateY = useSharedValue(20);
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(20);

  useEffect(() => {
    if (!isHeroTransitioning) {
      tabsOpacity.value = withDelay(120, withTiming(1, { duration: 220 }));
      tabsTranslateY.value = withDelay(120, withTiming(0, { duration: 220 }));
      contentOpacity.value = withDelay(160, withTiming(1, { duration: 240 }));
      contentTranslateY.value = withDelay(160, withTiming(0, { duration: 240 }));
    } else {
      tabsOpacity.value = 0;
      tabsTranslateY.value = 20;
      contentOpacity.value = 0;
      contentTranslateY.value = 20;
    }
  }, [isHeroTransitioning, tabsOpacity, tabsTranslateY, contentOpacity, contentTranslateY]);

  const tabsAnimStyle = useAnimatedStyle(() => ({
    opacity: tabsOpacity.value,
    transform: [{ translateY: tabsTranslateY.value }],
  }));

  const contentAnimStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

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
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: isSweeping
                ? 'Rolling back...'
                : `Rollback ${displayedTransactions.length} Pending (${totalPendingAmount} ${totalUnit.toUpperCase()})`,
              variant: 'primary',
              icon: 'mdi:broom',
              loading: isSweeping,
              disabled: isSweeping || displayedTransactions.length === 0,
              onPress: async () => {
                await handleSweep();
              },
            },
          ]}
        />
      </BottomButtons>
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
      <RNView style={{ flex: 1 }}>
        {/* Scrollable content underneath the sticky header */}
        <ModalLayoutWrapper
          contentPadding={0}
          bottomContent={sweepButton}
          bottomPadding={displayedTransactions.length > 0 ? 160 : 120}
          useAnimatedScroll
          scrollY={scrollY}
          disableHeaderSpacer
          scrollIndicatorInsets={{ top: Math.max(0, stickyHeaderHeight - nativeHeaderHeight) }}>
          {/* Spacer matching the sticky header height */}
          <RNView style={{ height: stickyHeaderHeight }} />

          {/* Transaction pages (swipeable PagerView) */}
          {mintsWithPending.length > 0 && (
            <Animated.View style={[contentAnimStyle, { marginTop: -HEADER_OVERLAP }]}>
              <PagerView
                ref={pagerRef}
                style={{ height: pagerHeight }}
                initialPage={0}
                onPageSelected={onPageSelected}>
                {mintsWithPending.map((mint) => {
                  const transactions = pendingByMint[mint.mintUrl] || [];
                  return (
                    <View
                      key={mint.mintUrl}
                      style={{ flex: 1, paddingHorizontal: 16, paddingTop: HEADER_OVERLAP }}>
                      <View style={[styles.transactionList, { borderColor: cardBorderColor }]}>
                        <BlurCardFrame accentColor={cardAccentColor}>
                          <View style={{ zIndex: 1 }}>
                            {transactions.map((tx) => (
                              <Transaction
                                key={tx.id}
                                historyEntry={tx as HistoryEntry}
                                isLoading={rollingBackIds.has(tx.operationId)}
                              />
                            ))}
                          </View>
                        </BlurCardFrame>
                      </View>
                    </View>
                  );
                })}
              </PagerView>
            </Animated.View>
          )}

          {/* Empty state (no pending ecash at all) */}
          {mintsWithPending.length === 0 && (
            <Animated.View
              style={[
                contentAnimStyle,
                {
                  paddingHorizontal: 16,
                  marginTop: -HEADER_OVERLAP,
                  paddingTop: HEADER_OVERLAP,
                },
              ]}>
              <View style={styles.emptyState}>
                <Icon
                  name="mdi:check-circle-outline"
                  size={48}
                  color={opacity(getPrimaryColor('0'), 0.33)}
                />
                <Spacer size={12} />
                <Text size={18} heavy style={{ color: opacity(getPrimaryColor('0'), 0.8) }}>
                  No Pending Ecash
                </Text>
                <Text
                  size={14}
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.4),
                    textAlign: 'center',
                    marginTop: 4,
                  }}>
                  All your sent ecash has been claimed
                </Text>
              </View>
            </Animated.View>
          )}
        </ModalLayoutWrapper>

        {/* Sticky header — always pinned at top, content scrolls behind it */}
        <RNView style={styles.stickyHeader} pointerEvents="box-none" onLayout={handleStickyLayout}>
          <RNView>
            {/* Background layers: solid covers top, gradient fades at bottom */}
            <RNView
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: getPrimaryColor('950'), bottom: HEADER_OVERLAP },
              ]}
            />
            <LinearGradient
              colors={[getPrimaryColor('950'), 'transparent']}
              style={styles.headerGradient}
              pointerEvents="none"
            />

            {/* Hero card */}
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
                <VStack style={{ padding: 18, paddingTop: 52 + topOffset, zIndex: 1 }}>
                  <HStack align="center" gap={10}>
                    <View
                      style={[styles.heroIcon, { backgroundColor: opacity(accentColor, 0.16) }]}>
                      <Icon name="mdi:clock-alert-outline" size={22} color={accentColor} />
                    </View>
                    <VStack>
                      <Text size={18} heavy style={{ color: opacity(getPrimaryColor('0'), 0.9) }}>
                        Pending Ecash
                      </Text>
                      <Text size={12} style={{ color: opacity(accentColor, 0.7) }}>
                        {pendingSends.length} unclaimed{' '}
                        {pendingSends.length === 1 ? 'token' : 'tokens'}
                      </Text>
                    </VStack>
                  </HStack>
                </VStack>
              </PendingEcashCardFrame>
            </RNView>

            {/* Mint tabs */}
            <Animated.View style={[tabsAnimStyle, { marginTop: 10 }]}>
              <MintTabs
                mints={mints}
                selectedMintUrl={effectiveSelectedMint}
                onMintChange={handleMintChange}
                pendingByMint={pendingByMint}
                scrollY={scrollY}
              />
            </Animated.View>
          </RNView>
        </RNView>
      </RNView>
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
    paddingBottom: 10,
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
  // Gradient covering the bottom of the sticky header — content fades as it scrolls behind
  headerGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: HEADER_OVERLAP,
  },
  // Sticky header overlay
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  // Other styles
  transactionList: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
});
