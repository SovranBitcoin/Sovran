import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useBalanceContext, useMints, usePaginatedHistory } from 'coco-cashu-react';
import { TOTAL_BASIS_POINTS, useMintDistributionStore } from 'stores/mintDistributionStore';
import { RowButton, Section } from 'app/settings-pages';
import Animated, { FadeInUp, type SharedValue } from 'react-native-reanimated';
import { MintCurrencyTabs } from 'components/blocks/sheets/mint-balance/MintCurrencyTabs';
import type { HealthCta } from './walletHealth';
import { WalletHealthCardFrame } from './WalletHealthCardFrame';

const HERO_PADDING = 18;
const HEART_RING_SIZE = 72;
const HEART_RING_RADIUS = HEART_RING_SIZE / 2;

function getMintsForUnit(trustedMints: any[], unit: string) {
  const u = unit.toLowerCase();
  return trustedMints.filter((mint) => {
    if (u === 'sat') {
      if (!mint.mintInfo?.nuts?.['4']?.methods) return true;
      return mint.mintInfo.nuts['4'].methods.some(
        (method: any) => method.unit?.toLowerCase() === 'sat'
      );
    }
    if (!mint.mintInfo?.nuts?.['4']?.methods) return false;
    return mint.mintInfo.nuts['4'].methods.some((method: any) => method.unit?.toLowerCase() === u);
  });
}

function normalizeBpLargestRemainder(
  mintUrls: string[],
  balances: Record<string, number>,
  total: number
): Record<string, number> {
  if (total <= 0) {
    return mintUrls.reduce(
      (acc, url) => {
        acc[url] = 0;
        return acc;
      },
      {} as Record<string, number>
    );
  }

  const rows = mintUrls.map((mintUrl) => {
    const bal = balances[mintUrl] || 0;
    const exact = (bal / total) * TOTAL_BASIS_POINTS;
    const floor = Math.floor(exact);
    return { mintUrl, floor, remainder: exact - floor };
  });

  const floorSum = rows.reduce((s, r) => s + r.floor, 0);
  let remaining = TOTAL_BASIS_POINTS - floorSum;

  // Deterministic rounding: stable tie-break by mintUrl.
  rows.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.mintUrl.localeCompare(b.mintUrl);
  });

  const out: Record<string, number> = {};
  for (const r of rows) {
    if (remaining > 0) {
      out[r.mintUrl] = r.floor + 1;
      remaining--;
    } else {
      out[r.mintUrl] = r.floor;
    }
  }
  return out;
}

function formatPctFromBp(bp: number): string {
  return `${Math.round(bp / 100)}%`;
}

function statLabelText(key: 'drift' | 'pending' | 'split'): string {
  if (key === 'drift') return 'Drift';
  if (key === 'pending') return 'Pending';
  return 'Split';
}

export function WalletHealthModalContent({
  unit,
  onAction,
  topOffset = 0,
  currencies,
  selectedCurrency,
  onCurrencyChange,
  scrollY,
}: {
  unit: string;
  onAction: (action: HealthCta) => void;
  topOffset?: number;
  currencies: string[];
  selectedCurrency: string;
  onCurrencyChange: (currency: string) => void;
  scrollY?: SharedValue<number>;
}) {
  const { getPrimaryColor, getRedColor } = useTheme();
  const primary50 = useMemo(() => getPrimaryColor('50'), [getPrimaryColor]);
  const primary300 = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const primary400 = useMemo(() => getPrimaryColor('400'), [getPrimaryColor]);
  const primary950 = useMemo(() => getPrimaryColor('950'), [getPrimaryColor]);
  const red = useMemo(() => getRedColor('300'), [getRedColor]);

  // Wallet Health hero: keep the background gradient consistently "red-warm" (like the Needs rebalance state),
  // even when the wallet is Balanced (where hero.accent is intentionally white for text/icon tones).
  const gradientAccent = red;

  const statPillBg = useMemo(() => opacity(gradientAccent, 0.1), [gradientAccent]);

  const { trustedMints } = useMints();
  const { balance } = useBalanceContext();
  const { history } = usePaginatedHistory();
  const distributions = useMintDistributionStore((s) => s.distributions);

  const normalizedUnit = unit.toLowerCase() === 'sat' ? 'sat' : unit.toLowerCase();
  const sharedTag = useMemo(() => `walletHealthCard-${normalizedUnit}`, [normalizedUnit]);

  const mintsForUnit = useMemo(
    () => getMintsForUnit(trustedMints, normalizedUnit),
    [trustedMints, normalizedUnit]
  );
  const mintUrlsForUnit = useMemo(() => mintsForUnit.map((m: any) => m.mintUrl), [mintsForUnit]);

  const desired = useMemo(
    () => distributions[normalizedUnit] || {},
    [distributions, normalizedUnit]
  );
  const hasDesired = useMemo(() => Object.values(desired).some((v) => (v || 0) > 0), [desired]);

  const totalBalance = useMemo(() => {
    return mintUrlsForUnit.reduce((sum, url) => sum + ((balance as any)?.[url] || 0), 0);
  }, [mintUrlsForUnit, balance]);

  const pendingOutgoingCount = useMemo(() => {
    return history.filter(
      (entry: any) =>
        entry.type === 'send' &&
        (entry.state === 'pending' || entry.state === 'prepared') &&
        (entry.unit?.toLowerCase?.() || 'sat') === normalizedUnit
    ).length;
  }, [history, normalizedUnit]);

  const { maxDriftBp } = useMemo(() => {
    if (!hasDesired || totalBalance <= 0) return { maxDriftBp: 0, largestShareBp: 0 };

    const actualBp = normalizeBpLargestRemainder(mintUrlsForUnit, balance as any, totalBalance);

    let maxDrift = 0;
    for (const url of mintUrlsForUnit) {
      const d = desired[url] || 0;
      const a = actualBp[url] || 0;
      maxDrift = Math.max(maxDrift, Math.abs(a - d));
    }

    return { maxDriftBp: maxDrift, largestShareBp: 0 };
  }, [hasDesired, totalBalance, mintUrlsForUnit, balance, desired]);

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

  // In the hero (which can be accent-washed), use "on-accent" text (white w/ opacity) instead of grey.
  const heroTitleColor = primary50;
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

  const handleRebalancePress = useMemo(() => {
    return () => onAction({ type: 'openRebalancePlan', unit: normalizedUnit });
  }, [onAction, normalizedUnit]);

  const handleSplitPress = useMemo(() => {
    return () => onAction({ type: 'openBalanceSplit', unit: normalizedUnit });
  }, [onAction, normalizedUnit]);

  const handlePendingPress = useMemo(() => {
    return () => onAction({ type: 'openPendingEcash' });
  }, [onAction]);

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
      label: React.ReactElement;
      value?: string;
      onPress?: () => void;
    }[] = [];

    if (hasDesired && totalBalance > 0) {
      // Show drift inline, similar to the pending count row.
      const driftValue = needsRebalance ? `~${formatPctFromBp(maxDriftBp)}` : 'OK';
      rows.push({
        key: 'rebalance',
        label: (
          <HStack align="center" gap={10}>
            <Icon name="mdi:swap-horizontal" size={18} color={primary400} />
            <Text style={{ color: primary50 }} bold>
              Rebalance now
            </Text>
          </HStack>
        ),
        value: driftValue,
        onPress: handleRebalancePress,
      });
    }

    rows.push({
      key: 'split',
      label: (
        <HStack align="center" gap={10}>
          <Icon name="fluent:split-vertical-24-filled" size={18} color={primary400} />
          <Text style={{ color: primary50 }} bold>
            {hasDesired ? 'Edit balance split' : 'Set balance split'}
          </Text>
        </HStack>
      ),
      value: !hasDesired ? 'Not set' : undefined,
      onPress: handleSplitPress,
    });

    if (pendingOutgoingCount > 0) {
      rows.push({
        key: 'pending',
        label: (
          <HStack align="center" gap={10}>
            <Icon name="mdi:clock-alert-outline" size={18} color={primary400} />
            <Text style={{ color: primary50 }} bold>
              View & reclaim pending ecash
            </Text>
          </HStack>
        ),
        value: `${pendingOutgoingCount}`,
        onPress: handlePendingPress,
      });
    }

    return rows;
  }, [
    hasDesired,
    totalBalance,
    needsRebalance,
    maxDriftBp,
    pendingOutgoingCount,
    primary50,
    primary400,
    handleRebalancePress,
    handleSplitPress,
    handlePendingPress,
  ]);

  return (
    <VStack gap={10}>
      {/* Overview (hero): centered heart + scannable stats */}
      <Animated.View
        sharedTransitionTag={sharedTag}
        // Keep a real native view node for shared transitions (avoid RN view-flattening).
        collapsable={false}
        shouldRasterizeIOS
        renderToHardwareTextureAndroid
        style={[
          styles.heroWrap,
          {
            borderColor: heroBorderColor,
            // Pull the hero background up behind the transparent header.
            // Then compensate with padding so inner content stays in the same place.
            marginTop: -topOffset,
            paddingTop: HERO_PADDING + topOffset,
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
              // Important: clip this gradient to the circle (see styles.heartRing overflow + radius).
              colors={[opacity(gradientAccent, 0.18), opacity(gradientAccent, 0.06), 'transparent']}
              locations={[0, 0.6, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { borderRadius: HEART_RING_RADIUS }]}
            />
            <Icon name="garden:heart-fill-16" size={30} color={hero.accent} />
          </View>

          <VStack align="center" gap={4} style={{ paddingHorizontal: 8 }}>
            <Text size={18} heavy style={{ color: heroTitleColor }} numberOfLines={1}>
              {hero.title}
            </Text>
            <Text
              size={13}
              style={{ color: heroSubtitleColor, textAlign: 'center' }}
              numberOfLines={2}>
              {hero.subtitle}
            </Text>
          </VStack>

          <HStack gap={10} style={{ width: '100%' }}>
            {heroStats.map((s) => (
              <View
                key={s.key}
                style={[
                  styles.statPill,
                  {
                    // Match the heart icon container treatment (tinted fill + subtle ring border)
                    backgroundColor: statPillBg,
                    borderColor: heartBorderColor,
                  },
                ]}>
                <Text size={10} style={{ color: statLabelColor }}>
                  {statLabelText(s.key)}
                </Text>
                <Text bold overpass size={14} style={{ color: s.tone }}>
                  {s.value}
                </Text>
              </View>
            ))}
          </HStack>
        </VStack>
      </Animated.View>

      {/* Currency selector (non-sticky) */}
      <Animated.View entering={FadeInUp.duration(220).delay(120)}>
        <MintCurrencyTabs
          currencies={currencies}
          selectedCurrency={selectedCurrency}
          onCurrencyChange={onCurrencyChange}
          scrollY={scrollY}
        />
      </Animated.View>

      {/* Actions (standard rows, like Mint Info / Settings) */}
      <Animated.View entering={FadeInUp.duration(240).delay(160)}>
        <View style={{ paddingHorizontal: 16 }}>
          <Section title="Actions">
            {actionRows.map((r, i) => (
              <RowButton
                key={r.key}
                isFirst={i === 0}
                isLast={i === actionRows.length - 1}
                label={r.label}
                value={r.value}
                onPress={r.onPress}
              />
            ))}
          </Section>
        </View>
      </Animated.View>
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
