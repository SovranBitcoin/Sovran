import type { PropsWithChildren } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import Icon from 'assets/icons';
import { KEYFRAME_EASINGS, useLoopClock } from '@/shared/hooks/useLoopClock';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { valueAt } from '@/shared/lib/motion/keyframes';
import { View } from '@/shared/ui/primitives/View/View';
import {
  DETAIL_OPACITY,
  ILLUSTRATION_CYCLE_MS,
  TRAVEL,
  TRAVEL_OPACITY,
} from './onboardingIllustration.timeline';

type OnboardingIllustrationKind = 'cashu' | 'nostr' | 'privacy' | 'start';

/** Decorative only: the card's words carry the full meaning, including mint risk. */
export function OnboardingIllustration({ kind }: { kind: OnboardingIllustrationKind }) {
  const foreground = useThemeColor('foreground');
  const t = useLoopClock(ILLUSTRATION_CYCLE_MS);
  const travel = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), TRAVEL_OPACITY, KEYFRAME_EASINGS),
    transform: [{ translateX: valueAt(t.get(), TRAVEL, KEYFRAME_EASINGS) }],
  }));
  const details = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), DETAIL_OPACITY, KEYFRAME_EASINGS),
  }));
  const settle = useAnimatedStyle(() => ({
    transform: [{ translateY: -8 * (1 - valueAt(t.get(), DETAIL_OPACITY, KEYFRAME_EASINGS)) }],
  }));

  let scene;
  switch (kind) {
    case 'cashu':
      scene = (
        <>
          <View className="border-foreground/20 bg-surface-secondary absolute left-2 h-36 w-20 rounded-3xl border-2" />
          <View className="border-foreground/20 bg-surface-secondary absolute right-2 h-36 w-20 rounded-3xl border-2" />
          <View className="bg-foreground/15 absolute h-px w-36" />
          <Animated.View style={travel}>
            <Coin />
          </Animated.View>
        </>
      );
      break;
    case 'nostr':
      scene = (
        <>
          <View className="flex-row gap-3">
            {[0, 1, 2].map((window) => (
              <View
                key={window}
                className="border-foreground/20 bg-surface-secondary h-28 w-16 gap-3 rounded-2xl border p-3">
                <View className="bg-foreground/25 h-1 w-5 rounded-full" />
                <View className="bg-foreground/10 h-1 w-8 rounded-full" />
              </View>
            ))}
          </View>
          <Animated.View className="absolute" style={travel}>
            <View className="border-foreground bg-background h-14 w-14 items-center justify-center rounded-full border-2">
              <Icon name="mdi:account-circle" size={32} color={foreground} />
            </View>
          </Animated.View>
        </>
      );
      break;
    case 'privacy':
      scene = (
        <View className="border-foreground/20 bg-surface-secondary w-56 gap-5 rounded-3xl border p-6">
          <View className="flex-row items-center gap-3">
            <Icon name="majesticons:eye" size={24} color={foreground} />
            <View className="bg-foreground/40 h-2 w-24 rounded-full" />
          </View>
          <Animated.View className="flex-row gap-2" style={details}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((dot) => (
              <View key={dot} className="bg-foreground/40 h-2 w-2 rounded-full" />
            ))}
          </Animated.View>
          <View className="bg-foreground/10 h-px" />
          <View className="flex-row items-center gap-3">
            <Icon name="mdi:bitcoin" size={24} color={foreground} />
            <View className="bg-foreground/20 h-2 w-16 rounded-full" />
          </View>
        </View>
      );
      break;
    case 'start':
      scene = (
        <View className="items-center gap-4">
          <Animated.View className="flex-row items-end gap-2" style={settle}>
            <Coin />
            <View className="gap-1">
              <Coin />
              <View className="border-foreground/30 bg-surface-secondary h-2 w-12 rounded-full border" />
            </View>
          </Animated.View>
          <View className="bg-foreground/20 h-px w-44" />
          <View className="flex-row gap-2">
            {[0, 1, 2].map((line) => (
              <View key={line} className="bg-foreground/15 h-1 w-8 rounded-full" />
            ))}
          </View>
        </View>
      );
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  return <Scene>{scene}</Scene>;
}

function Scene({ children }: PropsWithChildren) {
  return (
    <View
      className="h-52 w-64 items-center justify-center"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {children}
    </View>
  );
}

function Coin() {
  const foreground = useThemeColor('foreground');
  return (
    <View className="border-foreground bg-background h-12 w-12 items-center justify-center rounded-full border-2">
      <Icon name="mdi:bitcoin" size={28} color={foreground} />
    </View>
  );
}
