import React, { useMemo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { router } from 'expo-router';
import { useBalanceContext, useMints, usePaginatedHistory } from 'coco-cashu-react';
import { useMintDistributionStore } from 'stores/mintDistributionStore';
import { computeWalletHealth } from './walletHealth';

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

function chipIconName(label: string): string {
  const key = label.toLowerCase();
  if (key.includes('balanced')) return 'mdi:check-circle';
  if (key.includes('pending')) return 'mdi:clock-outline';
  if (key.includes('rebalance')) return 'mdi:swap-horizontal';
  if (key.includes('not configured')) return 'mdi:help-circle';
  if (key.includes('no balance')) return 'material-symbols:info-rounded';
  if (key.includes('concentrated')) return 'mdi:alert-circle';
  return 'lucide:activity';
}

export function WalletHealthCard({ defaultUnit = 'sat' }: { defaultUnit?: string }) {
  const { getPrimaryColor, getRedColor } = useTheme();
  const primary950 = useMemo(() => getPrimaryColor('950'), [getPrimaryColor]);
  const primary50 = useMemo(() => getPrimaryColor('50'), [getPrimaryColor]);
  const accentColor = useMemo(() => getRedColor('300'), [getRedColor]);

  const { trustedMints } = useMints();
  const { balance } = useBalanceContext();
  const { history } = usePaginatedHistory();
  const distributions = useMintDistributionStore((s) => s.distributions);

  const unit = defaultUnit.toLowerCase();
  const mintsForUnit = useMemo(() => getMintsForUnit(trustedMints, unit), [trustedMints, unit]);
  const mintUrlsForUnit = useMemo(() => mintsForUnit.map((m: any) => m.mintUrl), [mintsForUnit]);

  const pendingOutgoingCount = useMemo(() => {
    return history.filter(
      (entry: any) =>
        entry.type === 'send' &&
        (entry.state === 'pending' || entry.state === 'prepared') &&
        (entry.unit?.toLowerCase?.() || 'sat') === unit
    ).length;
  }, [history, unit]);

  const health = useMemo(() => {
    return computeWalletHealth({
      unit,
      mintUrlsForUnit,
      balancesByMintUrl: balance as any,
      desiredDistributionBp: distributions[unit] || {},
      pendingOutgoingCount,
    });
  }, [unit, mintUrlsForUnit, balance, distributions, pendingOutgoingCount]);

  const handlePress = useCallback(() => {
    router.push({ pathname: '/(drawer)/(tabs)/explore/healthModal', params: { unit } });
  }, [unit]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[styles.card, { borderColor: opacity(accentColor, 0.25) }]}
      onPress={handlePress}>
      {/* Same “3-corner” warm red blend used in the Wallet Health modal hero */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: primary950 }]} />
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(accentColor, 0.06) }]}
      />
      <LinearGradient
        colors={[opacity(accentColor, 0.34), opacity(accentColor, 0.12), 'transparent']}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[opacity(accentColor, 0.22), 'transparent', opacity(accentColor, 0.26)]}
        locations={[0, 0.55, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        colors={[opacity(primary50, 0.06), 'transparent']}
        locations={[0, 0.7]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Decorative hearts */}
      <View style={styles.decorationLeft} pointerEvents="none">
        <Icon name="garden:heart-fill-16" size={90} color={opacity(accentColor, 0.08)} />
      </View>
      <View style={styles.decorationRight} pointerEvents="none">
        <Icon name="garden:heart-fill-16" size={140} color={opacity(accentColor, 0.05)} />
      </View>

      <VStack style={{ padding: 18 }}>
        <HStack align="center" justify="space-between">
          <HStack align="center" gap={10}>
            <View style={[styles.iconBox, { backgroundColor: opacity(accentColor, 0.16) }]}>
              <Icon name="garden:heart-fill-16" size={22} color={accentColor} />
            </View>
            <VStack>
              <Text size={16} heavy style={{ color: primary50 }}>
                Wallet health
              </Text>
              <HStack align="center" gap={8} style={{ marginTop: 6 }}>
                <View
                  style={[
                    styles.unitPill,
                    {
                      backgroundColor: opacity(accentColor, 0.14),
                      borderColor: opacity(accentColor, 0.22),
                    },
                  ]}>
                  <Text size={10} heavy style={{ color: opacity(accentColor, 0.9) }}>
                    {unit.toUpperCase()}
                  </Text>
                </View>
                <Text size={11} style={{ color: opacity(accentColor, 0.7) }}>
                  Tap for details
                </Text>
              </HStack>
            </VStack>
          </HStack>
          <Icon name="mdi:chevron-right" size={22} color={opacity(primary50, 0.85)} />
        </HStack>

        {/* Status row - styled like “Easy to share / Scannable QR” */}
        <HStack align="center" style={{ marginTop: 14, gap: 16, flexWrap: 'wrap' }}>
          {health.chips.map((chip) => {
            const iconName = chipIconName(chip.label);
            // On this red/heart card: use white for “Balanced”, and red accent for everything else.
            const isBalanced = chip.label.toLowerCase().includes('balanced');
            const displayColor = isBalanced ? opacity(primary50, 0.85) : opacity(accentColor, 0.8);
            return (
              <HStack key={chip.label} align="center" gap={6}>
                <Icon name={iconName} size={14} color={displayColor} />
                <Text size={11} style={{ color: displayColor }}>
                  {chip.label}
                </Text>
              </HStack>
            );
          })}
        </HStack>

        {/* Subtle CTA row */}
        <View
          style={[
            styles.cta,
            {
              backgroundColor: opacity(accentColor, 0.12),
              borderColor: opacity(accentColor, 0.22),
            },
          ]}>
          <HStack align="center" justify="space-between">
            <HStack align="center" gap={8}>
              {/* Use an icon already included in metro.config.js */}
              <Icon
                name="material-symbols:info-rounded"
                size={16}
                color={opacity(accentColor, 0.9)}
              />
              <Text size={12} heavy style={{ color: primary50 }}>
                View health details
              </Text>
            </HStack>
            <Icon name="mdi:arrow-right" size={18} color={primary50} />
          </HStack>
        </View>
      </VStack>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
  },
  decorationLeft: {
    position: 'absolute',
    top: -18,
    left: -18,
    transform: [{ rotate: '-12deg' }],
  },
  decorationRight: {
    position: 'absolute',
    bottom: -34,
    right: -34,
    transform: [{ rotate: '14deg' }],
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  cta: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
