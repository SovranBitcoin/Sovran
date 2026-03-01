import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View as RNView } from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';
import { ListGroup, PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  type SharedValue,
} from 'react-native-reanimated';

import Icon from 'assets/icons';
import { ROW_ICON_SIZE, Section } from 'app/settings-pages';
import { MintCurrencyTabs } from 'components/blocks/sheets/mint-balance/MintCurrencyTabs';
import { Text } from 'components/ui/Text';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { useThemeColor } from 'hooks/useThemeColor';

import { useWalletHealthData } from './useWalletHealthData';
import type { HealthCta } from './walletHealth';
import { formatPctFromBp, normalizeBpLargestRemainder } from './walletHealth';
import { WalletHealthCardFrame } from './WalletHealthCardFrame';

const HERO_PADDING = 18;
const HEART_RING_SIZE = 72;
const HEART_RING_RADIUS = HEART_RING_SIZE / 2;

function statLabelText(key: 'drift' | 'pending' | 'split'): string {
  if (key === 'drift') return 'Drift';
  if (key === 'pending') return 'Pending';
  return 'Split';
}

export interface WalletHealthLayout {
  heroContent: React.ReactNode;
  tabsContent: React.ReactNode;
  bodyContent: React.ReactNode;
}

export function WalletHealthModalContent({
  unit,
  onAction,
  topOffset = 0,
  currencies,
  selectedCurrency,
  onCurrencyChange,
  scrollY,
  children,
}: {
  unit: string;
  onAction: (action: HealthCta) => void;
  topOffset?: number;
  currencies: string[];
  selectedCurrency: string;
  onCurrencyChange: (currency: string) => void;
  scrollY?: SharedValue<number>;
  children?: (layout: WalletHealthLayout) => React.ReactNode;
}) {
  const [foreground, background, shade300] = useThemeColor([
    'foreground',
    'background',
    'shade-300',
  ] as const);
  const heroTransition = useHeroTransition();
  const primary50 = useMemo(() => opacity(foreground, 0.9), [foreground]);
  const primary300 = useMemo(() => opacity(foreground, 0.5), [foreground]);
  const primary400 = useMemo(() => opacity(foreground, 0.4), [foreground]);
  const primary950 = background;
  const red = shade300;

  // Keep the background gradient consistently "red-warm" (like the Needs rebalance state),
  // even when the wallet is Balanced (where hero.accent is intentionally white for text/icon tones).
  const gradientAccent = red;

  const statPillBg = useMemo(() => opacity(gradientAccent, 0.1), [gradientAccent]);

  const { normalizedUnit, balance, mintUrlsForUnit, desiredDistributionBp, pendingOutgoingCount } =
    useWalletHealthData(unit);

  const heroRef = useRef<RNView>(null);

  const handleHeroLayout = useCallback(() => {
    heroTransition.registerRef('walletHealth', 'destination', heroRef.current);
  }, [heroTransition]);

  const hasDesired = useMemo(
    () => Object.values(desiredDistributionBp).some((v) => (v || 0) > 0),
    [desiredDistributionBp]
  );

  const totalBalance = useMemo(() => {
    return mintUrlsForUnit.reduce((sum, url) => sum + (balance[url] || 0), 0);
  }, [mintUrlsForUnit, balance]);

  const maxDriftBp = useMemo(() => {
    if (!hasDesired || totalBalance <= 0) return 0;

    const actualBp = normalizeBpLargestRemainder(mintUrlsForUnit, balance, totalBalance);

    let maxDrift = 0;
    for (const url of mintUrlsForUnit) {
      const d = desiredDistributionBp[url] || 0;
      const a = actualBp[url] || 0;
      maxDrift = Math.max(maxDrift, Math.abs(a - d));
    }

    return maxDrift;
  }, [hasDesired, totalBalance, mintUrlsForUnit, balance, desiredDistributionBp]);

  const needsRebalance = hasDesired && totalBalance > 0 && maxDriftBp >= 200;

  // Palette rule: keep “healthy” white, and use red for anything requiring attention.
  const accent = useMemo(() => {
    if (totalBalance <= 0) return primary300;
    if (!hasDesired) return red;
    if (needsRebalance) return red;
    return opacity(primary50, 0.92);
  }, [totalBalance, hasDesired, needsRebalance, primary300, primary50, red]);

  const hero = useMemo(() => {
    if (totalBalance <= 0) {
      return {
        severity: 'info' as const,
        title: 'No balance',
        subtitle: 'Add funds to see drift and rebalancing options.',
        accent,
      };
    }
    if (!hasDesired) {
      return {
        severity: 'warn' as const,
        title: 'Set up your balance split',
        subtitle: 'Choose how balances should be split across mints.',
        accent,
      };
    }
    if (needsRebalance) {
      return {
        severity: 'warn' as const,
        title: 'Needs rebalance',
        subtitle: `Off by ~${formatPctFromBp(maxDriftBp)} from your balance split.`,
        accent,
      };
    }
    return {
      severity: 'ok' as const,
      title: 'Balanced',
      subtitle: 'Balances are close to your balance split.',
      accent,
    };
  }, [totalBalance, hasDesired, needsRebalance, maxDriftBp, accent]);

  const driftStat = useMemo(() => {
    if (totalBalance <= 0) return '—';
    if (!hasDesired) return '—';
    return needsRebalance ? `~${formatPctFromBp(maxDriftBp)}` : 'OK';
  }, [totalBalance, hasDesired, needsRebalance, maxDriftBp]);

  const pendingStat = useMemo(() => {
    return pendingOutgoingCount > 0 ? `${pendingOutgoingCount}` : '0';
  }, [pendingOutgoingCount]);

  const splitStat = useMemo(() => {
    if (totalBalance <= 0) return '—';
    return hasDesired ? 'Set' : 'Not set';
  }, [totalBalance, hasDesired]);

  const heroSubtitleColor = useMemo(() => opacity(primary50, 0.72), [primary50]);
  const statLabelColor = useMemo(() => opacity(primary50, 0.6), [primary50]);

  // Match the Explore card’s border so the shared element doesn't "snap" on arrival.
  const heroBorderColor = useMemo(() => opacity(gradientAccent, 0.25), [gradientAccent]);

  const heartBorderColor = useMemo(() => {
    // When we’re highlighting an issue, make the ring border a real red shade (not grey).
    if (totalBalance > 0 && (!hasDesired || needsRebalance)) {
      return opacity(red, 0.38);
    }
    // Otherwise keep it subtle and “polished” on dark backgrounds.
    return opacity(primary50, 0.16);
  }, [totalBalance, hasDesired, needsRebalance, red, primary50]);

  const handleRebalancePress = useCallback(() => {
    onAction({ type: 'openRebalancePlan', unit: normalizedUnit });
  }, [onAction, normalizedUnit]);

  const handleSplitPress = useCallback(() => {
    onAction({ type: 'openBalanceSplit', unit: normalizedUnit });
  }, [onAction, normalizedUnit]);

  const heroStats = useMemo(() => {
    return [
      {
        key: 'drift' as const,
        value: driftStat,
        tone: needsRebalance ? hero.accent : opacity(primary50, 0.9),
      },
      {
        key: 'pending' as const,
        value: pendingStat,
        tone: pendingOutgoingCount > 0 ? hero.accent : opacity(primary50, 0.9),
      },
      {
        key: 'split' as const,
        value: splitStat,
        tone: hasDesired ? opacity(primary50, 0.9) : hero.accent,
      },
    ] as const;
  }, [
    driftStat,
    pendingStat,
    splitStat,
    needsRebalance,
    pendingOutgoingCount,
    hasDesired,
    hero.accent,
    primary50,
  ]);

  const actionRows = useMemo(() => {
    const rows: {
      key: string;
      leftIcon?: React.ReactNode;
      label: string;
      value?: string;
      onPress?: () => void;
    }[] = [];

    if (hasDesired && totalBalance > 0) {
      // Show drift inline, similar to the pending count row.
      const driftValue = needsRebalance ? `~${formatPctFromBp(maxDriftBp)}` : 'OK';
      rows.push({
        key: 'rebalance',
        leftIcon: <Icon name="mdi:swap-horizontal" size={ROW_ICON_SIZE} color={primary400} />,
        label: 'Rebalance now',
        value: driftValue,
        onPress: handleRebalancePress,
      });
    }

    rows.push({
      key: 'split',
      leftIcon: (
        <Icon name="fluent:split-vertical-24-filled" size={ROW_ICON_SIZE} color={primary400} />
      ),
      label: hasDesired ? 'Edit balance split' : 'Set balance split',
      value: !hasDesired ? 'Not set' : undefined,
      onPress: handleSplitPress,
    });

    return rows;
  }, [
    hasDesired,
    totalBalance,
    needsRebalance,
    maxDriftBp,
    primary400,
    handleRebalancePress,
    handleSplitPress,
  ]);

  // ---------------------------------------------------------------------------
  // Safe fade-in animations (always mounted, no mount/unmount race with Core Animation)
  // ---------------------------------------------------------------------------
  const isHeroTransitioning = heroTransition.isTransitioning('walletHealth');

  const tabsOpacity = useSharedValue(0);
  const tabsTranslateY = useSharedValue(20);
  const bodyOpacity = useSharedValue(0);
  const bodyTranslateY = useSharedValue(20);

  useEffect(() => {
    if (!isHeroTransitioning) {
      tabsOpacity.value = withDelay(120, withTiming(1, { duration: 220 }));
      tabsTranslateY.value = withDelay(120, withTiming(0, { duration: 220 }));
      bodyOpacity.value = withDelay(160, withTiming(1, { duration: 240 }));
      bodyTranslateY.value = withDelay(160, withTiming(0, { duration: 240 }));
    } else {
      tabsOpacity.value = 0;
      tabsTranslateY.value = 20;
      bodyOpacity.value = 0;
      bodyTranslateY.value = 20;
    }
  }, [isHeroTransitioning, tabsOpacity, tabsTranslateY, bodyOpacity, bodyTranslateY]);

  const tabsAnimStyle = useAnimatedStyle(() => ({
    opacity: tabsOpacity.value,
    transform: [{ translateY: tabsTranslateY.value }],
  }));

  const bodyAnimStyle = useAnimatedStyle(() => ({
    opacity: bodyOpacity.value,
    transform: [{ translateY: bodyTranslateY.value }],
  }));

  const heroContent = (
    <RNView
      ref={heroRef}
      onLayout={handleHeroLayout}
      collapsable={false}
      shouldRasterizeIOS
      renderToHardwareTextureAndroid
      style={[
        styles.heroWrap,
        {
          borderColor: heroBorderColor,
          opacity: heroTransition.isHidden('walletHealth', 'destination') ? 0 : 1,
          marginTop: -topOffset,
          paddingTop: HERO_PADDING + topOffset * 2,
        },
      ]}>
      <WalletHealthCardFrame
        accentColor={gradientAccent}
        backgroundColor={primary950}
        highlightColor={primary50}
      />

      <VStack align="center" gap={10}>
        <View style={[styles.heartRing, { borderColor: heartBorderColor }]}>
          <LinearGradient
            colors={[opacity(gradientAccent, 0.18), opacity(gradientAccent, 0.06), 'transparent']}
            locations={[0, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFillObject, { borderRadius: HEART_RING_RADIUS }]}
          />
          <Icon name="garden:heart-fill-16" size={30} color={hero.accent} />
        </View>

        <VStack align="center" gap={4} className="px-2">
          <Text size={18} heavy style={{ color: primary50 }} numberOfLines={1}>
            {hero.title}
          </Text>
          <Text
            size={13}
            style={{ color: heroSubtitleColor, textAlign: 'center' }}
            numberOfLines={2}>
            {hero.subtitle}
          </Text>
        </VStack>

        <HStack gap={10} className="w-full">
          {heroStats.map((s) => (
            <View
              key={s.key}
              style={[
                styles.statPill,
                {
                  backgroundColor: statPillBg,
                  borderColor: heartBorderColor,
                },
              ]}>
              <Text size={10} style={{ color: statLabelColor }}>
                {statLabelText(s.key)}
              </Text>
              <Text bold size={14} style={{ color: s.tone }}>
                {s.value}
              </Text>
            </View>
          ))}
        </HStack>
      </VStack>
    </RNView>
  );

  const tabsContent = (
    <Animated.View style={tabsAnimStyle}>
      <MintCurrencyTabs
        currencies={currencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={onCurrencyChange}
        scrollY={scrollY}
      />
    </Animated.View>
  );

  const bodyContent = (
    <Animated.View style={bodyAnimStyle}>
      <View className="px-4">
        <Section title="Actions">
          <ListGroup variant="secondary">
            {actionRows.map((r) => (
              <PressableFeedback key={r.key} animation={false} onPress={r.onPress}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>{r.leftIcon}</ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{r.label}</ListGroup.ItemTitle>
                      {r.value ? (
                        <ListGroup.ItemDescription>{r.value}</ListGroup.ItemDescription>
                      ) : null}
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix />
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            ))}
          </ListGroup>
        </Section>
      </View>
    </Animated.View>
  );

  // Render callback: parent controls the layout (sticky header, scroll, etc.)
  if (children) {
    return <>{children({ heroContent, tabsContent, bodyContent })}</>;
  }

  // Fallback: original inline layout
  return (
    <VStack gap={10}>
      {heroContent}
      {tabsContent}
      {bodyContent}
    </VStack>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 20,
    borderWidth: 1,
    padding: HERO_PADDING,
    overflow: 'hidden',
  },
  heartRing: {
    width: HEART_RING_SIZE,
    height: HEART_RING_SIZE,
    borderRadius: HEART_RING_RADIUS,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  statPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
