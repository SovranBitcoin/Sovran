/* eslint-disable no-restricted-syntax -- [DEBUG-inv] tile colors are fixed
 * screenshot targets for the pixel-count loop; they must NOT follow the theme. */
/* eslint-disable @typescript-eslint/no-require-imports -- the dev probe loads only when a tile renders, keeping catalog metadata imports side-effect free. */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { CurrencyIcon } from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import type { DesignSystemScenario } from './catalog';

const TEXT_SOURCE = 'shared/ui/primitives/Text.tsx';
const HSTACK_SOURCE = 'shared/ui/primitives/View/HStack.tsx';
const VIEW_SOURCE = 'shared/ui/primitives/View/View.tsx';
const VSTACK_SOURCE = 'shared/ui/primitives/View/VStack.tsx';

export const FADE_STRESS_TILE_VARIANTS = ['plain', 'scale', 'delayed', 'quick', 'svg'] as const;
type FadeStressTileVariant = (typeof FADE_STRESS_TILE_VARIANTS)[number];
type FadeStressDiagnosticState = 'animated' | 'visible' | 'hidden' | 'stuck';

export const FADE_STRESS_TILE_COUNT = 45;
export const FADE_STRESS_CYCLE_MS = 2000;
/** Latest reveal: withDelay caps at 300ms + 350ms timing → 650ms; probe well past it. */
const PROBE_DEADLINE_MS = 1200;
const DIAGNOSTIC_TILE_SIZE = 40;

export function FadeStressTile({
  index,
  variant,
  size,
  onResult,
  diagnosticState = 'animated',
}: {
  index: number;
  variant: FadeStressTileVariant;
  size: number;
  onResult?: (stuck: boolean) => void;
  diagnosticState?: FadeStressDiagnosticState;
}) {
  // Keep catalog metadata imports side-effect free; the dev probe logs its
  // build marker when an actual stress tile renders.
  const { useFadeRevealProbe } =
    require('@/shared/lib/debug/fadeRevealProbe') as typeof import('@/shared/lib/debug/fadeRevealProbe');
  const animated = diagnosticState === 'animated';
  const progress = useSharedValue(animated || diagnosticState === 'hidden' ? 0 : 1);

  useEffect(() => {
    if (!animated) {
      progress.set(diagnosticState === 'hidden' ? 0 : 1);
      return;
    }

    switch (variant) {
      case 'plain':
        progress.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
        break;
      case 'scale':
        progress.set(withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
        break;
      case 'delayed':
        progress.set(
          withDelay(
            Math.min(index * 20, 300),
            withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) })
          )
        );
        break;
      case 'quick':
        progress.set(withTiming(1, { duration: 180 }));
        break;
      case 'svg':
        progress.set(withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
        break;
    }
  }, [animated, diagnosticState, index, progress, variant]);

  // A stuck tile is repainted solid red by a state flip so it is visible even
  // though its animated opacity is 0 — the red square is the loop "going red".
  const [flaggedStuck, setFlaggedStuck] = useState(false);
  const handleProbeResult = useCallback(
    (stuck: boolean) => {
      setFlaggedStuck(stuck);
      onResult?.(stuck);
    },
    [onResult]
  );
  const probeOptions = React.useMemo(
    () => ({
      deadlineMs: PROBE_DEADLINE_MS,
      enabled: animated,
      onResult: handleProbeResult,
    }),
    [animated, handleProbeResult]
  );
  useFadeRevealProbe(`stress:${variant}:${index}`, progress, probeOptions);

  const animStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: value,
      transform: [
        ...(variant === 'scale' ? [{ scale: value }] : []),
        ...(variant === 'delayed' ? [{ translateY: (1 - value) * 12 }] : []),
      ],
    };
  });
  const stuckStyle = React.useMemo(
    () => [styles.tile, { width: size, height: size, backgroundColor: '#ff2d2d' }],
    [size]
  );
  const tileStyle = React.useMemo(
    () => [
      styles.tile,
      { width: size, height: size, backgroundColor: variantColor(variant) },
      animStyle,
    ],
    [animStyle, size, variant]
  );

  if (diagnosticState === 'stuck' || flaggedStuck) {
    return <View style={stuckStyle} />;
  }

  return (
    <Animated.View style={tileStyle}>
      {variant === 'svg' ? <CurrencyIcon width={size * 0.6} currency="sat" /> : null}
    </Animated.View>
  );
}

function variantColor(variant: FadeStressTileVariant): string {
  switch (variant) {
    case 'plain':
      return '#31d0aa';
    case 'scale':
      return '#4f9cf9';
    case 'delayed':
      return '#f9a94f';
    case 'quick':
      return '#c56bf0';
    case 'svg':
      return '#e05c8a';
  }
}

function DiagnosticTileRow({ state }: { state: Exclude<FadeStressDiagnosticState, 'animated'> }) {
  return (
    <HStack gap={8} wrap="wrap">
      {FADE_STRESS_TILE_VARIANTS.map((variant, index) => (
        <VStack key={variant} gap={4} align="center">
          <FadeStressTile
            index={index}
            variant={variant}
            size={DIAGNOSTIC_TILE_SIZE}
            diagnosticState={state}
          />
          <Text size={9}>{variant}</Text>
        </VStack>
      ))}
    </HStack>
  );
}

export const FADE_REVEAL_STRESS_SCENARIOS = [
  {
    id: 'tiles-visible',
    title: 'Diagnostics · Visible',
    covers: [TEXT_SOURCE, HSTACK_SOURCE, VSTACK_SOURCE],
    render: () => <DiagnosticTileRow state="visible" />,
  },
  {
    id: 'tiles-hidden',
    title: 'Diagnostics · Hidden',
    covers: [TEXT_SOURCE, HSTACK_SOURCE, VSTACK_SOURCE],
    render: () => <DiagnosticTileRow state="hidden" />,
  },
  {
    id: 'tiles-stuck',
    title: 'Diagnostics · Stuck',
    covers: [TEXT_SOURCE, HSTACK_SOURCE, VIEW_SOURCE, VSTACK_SOURCE],
    render: () => <DiagnosticTileRow state="stuck" />,
  },
] satisfies readonly DesignSystemScenario[];

const styles = StyleSheet.create({
  tile: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
