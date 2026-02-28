import React, { useMemo, useCallback, useRef } from 'react';
import { StyleSheet, View as RNView } from 'react-native';
import opacity from 'hex-color-opacity';
import { View } from 'components/ui/View/View';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useBalanceContext, useMints, usePaginatedHistory } from 'coco-cashu-react';
import { useMintDistributionStore } from 'stores/mintDistributionStore';
import { WalletHealthCardFrame } from './WalletHealthCardFrame';
import { computeWalletHealth } from './walletHealth';
import { useHeroTransition } from '@/components/ui/hero-transition/HeroTransitionProvider';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { useThemeColor } from 'hooks/useThemeColor';

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
  const [background, foreground, shade300] = useThemeColor([
    'background',
    'foreground',
    'shade-300',
  ] as const);
  const primary950 = background;
  const primary0 = foreground;
  const primary50 = useMemo(() => opacity(primary0, 0.9), [primary0]);
  const accentColor = shade300;
  const hero = useHeroTransition();

  const { trustedMints } = useMints();
  const { balance } = useBalanceContext();
  const { history } = usePaginatedHistory();
  const distributions = useMintDistributionStore((s) => s.distributions);

  const unit = defaultUnit.toLowerCase();
  const cardRef = useRef<any>(null);
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
    hero.registerRef('walletHealth', 'source', cardRef.current);
    hero.startWalletHealth(unit);
  }, [hero, unit]);

  // Animated press state: GPU-accelerated scale + opacity (skill 3.3 / 7.1)
  const pressed = useSharedValue(0);

  const tap = Gesture.Tap()
    .onBegin(() => {
      pressed.set(withTiming(1, { duration: 150 }));
    })
    .onFinalize(() => {
      pressed.set(withTiming(0, { duration: 200 }));
    })
    .onEnd(() => {
      runOnJS(handlePress)();
    });

  const pressAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, 0.975]) }],
    opacity: interpolate(pressed.get(), [0, 1], [1, 0.92]),
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={pressAnimStyle}>
        <RNView
          ref={cardRef}
          onLayout={() => hero.registerRef('walletHealth', 'source', cardRef.current)}
          // Keep a real native view node for shared transitions (avoid RN view-flattening).
          collapsable={false}
          shouldRasterizeIOS
          renderToHardwareTextureAndroid
          style={[
            styles.card,
            {
              borderColor: opacity(accentColor, 0.25),
              opacity: hero.isHidden('walletHealth', 'source') ? 0 : 1,
            },
          ]}>
          <WalletHealthCardFrame
            accentColor={accentColor}
            backgroundColor={primary950}
            highlightColor={primary50}>
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
                  const displayColor = isBalanced
                    ? opacity(primary50, 0.85)
                    : opacity(accentColor, 0.8);
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
          </WalletHealthCardFrame>
        </RNView>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
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
