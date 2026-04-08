import React, { useMemo, useCallback, useRef } from 'react';
import { StyleSheet, View as RNView } from 'react-native';

import opacity from 'hex-color-opacity';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';

import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useHeroTransition } from '@/shared/providers/hero-transition/HeroTransitionProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import { useWalletHealthData } from '../hooks/useWalletHealthData';
import { computeWalletHealth } from '../lib/walletHealth';
import { WalletHealthCardFrame } from './WalletHealthCardFrame';
import { walletLog, Log } from '@/shared/lib/logger';

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
  const [background, foreground, red300] = useThemeColor([
    'background',
    'foreground',
    'red-300',
  ] as const);
  const primary950 = background;
  const primary0 = foreground;
  const primary50 = useMemo(() => opacity(primary0, 0.9), [primary0]);
  const accentColor = red300;
  const hero = useHeroTransition();

  const { normalizedUnit, balance, mintUrlsForUnit, desiredDistributionBp, pendingOutgoingCount } =
    useWalletHealthData(defaultUnit);

  const cardRef = useRef<RNView>(null);

  const health = useMemo(() => {
    return computeWalletHealth({
      unit: normalizedUnit,
      mintUrlsForUnit,
      balancesByMintUrl: balance,
      desiredDistributionBp,
      pendingOutgoingCount,
    });
  }, [normalizedUnit, mintUrlsForUnit, balance, desiredDistributionBp, pendingOutgoingCount]);

  const handlePress = useCallback(() => {
    walletLog.info('wallet.health.card.press', {
      unit: normalizedUnit,
      chips: health.chips.map((c) => c.label),
    });
    hero.registerRef('walletHealth', 'source', cardRef.current);
    hero.startWalletHealth(normalizedUnit);
  }, [hero, normalizedUnit, health.chips]);

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
    <Log name="WalletHealthCard">
      <GestureDetector gesture={tap}>
        <Animated.View style={pressAnimStyle}>
          <RNView
            ref={cardRef}
            onLayout={() => hero.registerRef('walletHealth', 'source', cardRef.current)}
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
              <VStack className="p-4.5">
                <HStack align="center" justify="space-between">
                  <HStack align="center" gap={10}>
                    <View style={[styles.iconBox, { backgroundColor: opacity(accentColor, 0.16) }]}>
                      <Icon name="garden:heart-fill-16" size={22} color={accentColor} />
                    </View>
                    <VStack>
                      <Text size={16} heavy style={{ color: primary50 }}>
                        Wallet health
                      </Text>
                      <HStack align="center" gap={8} className="mt-1.5">
                        <View
                          style={[
                            styles.unitPill,
                            {
                              backgroundColor: opacity(accentColor, 0.14),
                              borderColor: opacity(accentColor, 0.22),
                            },
                          ]}>
                          <Text size={10} heavy style={{ color: opacity(accentColor, 0.9) }}>
                            {normalizedUnit.toUpperCase()}
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

                <HStack align="center" className="mt-3.5 flex-wrap gap-4">
                  {health.chips.map((chip) => {
                    const iconName = chipIconName(chip.label);
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
    </Log>
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
