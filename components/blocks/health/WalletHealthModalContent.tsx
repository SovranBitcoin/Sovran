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
import type { HealthCta } from './walletHealth';

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
}: {
  unit: string;
  onAction: (action: HealthCta) => void;
}) {
  const { getPrimaryColor, getRedColor } = useTheme();
  const primary0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primary50 = useMemo(() => getPrimaryColor('50'), [getPrimaryColor]);
  const primary300 = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const primary400 = useMemo(() => getPrimaryColor('400'), [getPrimaryColor]);
  const primary900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);
  const red = useMemo(() => getRedColor('300'), [getRedColor]);

  const { trustedMints } = useMints();
  const { balance } = useBalanceContext();
  const { history } = usePaginatedHistory();
  const distributions = useMintDistributionStore((s) => s.distributions);

  const normalizedUnit = unit.toLowerCase() === 'sat' ? 'sat' : unit.toLowerCase();

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

  const heroBorderColor = useMemo(() => {
    // Match the Explore card’s “accent-tinted” border: red when attention is needed.
    if (totalBalance > 0 && (!hasDesired || needsRebalance)) {
      return opacity(red, 0.25);
    }
    // Balanced: subtle white border.
    if (totalBalance > 0 && hasDesired && !needsRebalance) {
      return opacity(primary50, 0.14);
    }
    // No balance / neutral: fall back to a soft theme border.
    return opacity(primary400, 0.18);
  }, [totalBalance, hasDesired, needsRebalance, red, primary50, primary400]);

  const heartBorderColor = useMemo(() => {
    // When we’re highlighting an issue, make the ring border a real red shade (not grey).
    if (totalBalance > 0 && (!hasDesired || needsRebalance)) {
      return opacity(red, 0.38);
    }
    // Otherwise keep it subtle and “polished” on dark backgrounds.
    return opacity(primary50, 0.16);
  }, [totalBalance, hasDesired, needsRebalance, red, primary50]);

  return (
    <VStack gap={10}>
      {/* Overview (hero): centered heart + scannable stats */}
      <View style={[styles.heroWrap, { borderColor: heroBorderColor }]}>
        {/* Base fill: keep it warm (near-black) instead of muddy grey */}
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: getPrimaryColor('950') }]}
        />

        {/* Global warm wash so the hero always feels “red-tinted”, not grey */}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(red, 0.06) }]} />

        {/**
         * 3-corner blend:
         * - Top-left: strongest accent
         * - Top-right: slightly different shade
         * - Bottom-right: deeper accent
         *
         * expo-linear-gradient is 1D, so we layer 2 gradients to approximate a 2D corner blend.
         */}
        <LinearGradient
          colors={[opacity(hero.accent, 0.34), opacity(hero.accent, 0.12), 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={[opacity(hero.accent, 0.22), 'transparent', opacity(hero.accent, 0.26)]}
          locations={[0, 0.55, 1]}
          start={{ x: 1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Subtle top highlight (keeps it premium, not flat) */}
        <LinearGradient
          colors={[opacity(primary0, 0.06), 'transparent']}
          locations={[0, 0.7]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        <VStack align="center" gap={10}>
          <View style={[styles.heartRing, { borderColor: heartBorderColor }]}>
            <LinearGradient
              // Important: clip this gradient to the circle (see styles.heartRing overflow + radius).
              colors={[opacity(hero.accent, 0.18), opacity(hero.accent, 0.06), 'transparent']}
              locations={[0, 0.6, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 36 }]}
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
            {(
              [
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
              ] as const
            ).map((s) => (
              <View
                key={s.key}
                style={[
                  styles.statPill,
                  {
                    backgroundColor: opacity(primary900, 0.55),
                    borderColor: opacity(primary400, 0.16),
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
      </View>

      {/* Actions (standard rows, like Mint Info / Settings) */}
      <Section title="Actions">
        {(() => {
          const rows: Array<{
            key: string;
            label: React.ReactElement;
            value?: string;
            onPress?: () => void;
          }> = [];

          if (hasDesired && totalBalance > 0) {
            // Show drift inline, similar to the pending count row.
            const driftValue = needsRebalance ? `~${formatPctFromBp(maxDriftBp)}` : 'OK';
            rows.push({
              key: 'rebalance',
              label: (
                <HStack align="center" gap={10}>
                  <Icon name="mdi:swap-horizontal" size={18} color={getPrimaryColor('400')} />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    Rebalance now
                  </Text>
                </HStack>
              ),
              value: driftValue,
              onPress: () => onAction({ type: 'openRebalancePlan', unit: normalizedUnit }),
            });
          }

          rows.push({
            key: 'split',
            label: (
              <HStack align="center" gap={10}>
                <Icon
                  name="fluent:split-vertical-24-filled"
                  size={18}
                  color={getPrimaryColor('400')}
                />
                <Text style={{ color: getPrimaryColor('50') }} bold>
                  {hasDesired ? 'Edit balance split' : 'Set balance split'}
                </Text>
              </HStack>
            ),
            value: !hasDesired ? 'Not set' : undefined,
            onPress: () => onAction({ type: 'openBalanceSplit', unit: normalizedUnit }),
          });

          if (pendingOutgoingCount > 0) {
            rows.push({
              key: 'pending',
              label: (
                <HStack align="center" gap={10}>
                  <Icon name="mdi:clock-alert-outline" size={18} color={getPrimaryColor('400')} />
                  <Text style={{ color: getPrimaryColor('50') }} bold>
                    View & reclaim pending ecash
                  </Text>
                </HStack>
              ),
              value: `${pendingOutgoingCount}`,
              onPress: () => onAction({ type: 'openPendingEcash' }),
            });
          }

          return rows.map((r, i) => (
            <RowButton
              key={r.key}
              isFirst={i === 0}
              isLast={i === rows.length - 1}
              label={r.label}
              value={r.value}
              onPress={r.onPress}
            />
          ));
        })()}
      </Section>
    </VStack>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    overflow: 'hidden',
  },
  heartRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
