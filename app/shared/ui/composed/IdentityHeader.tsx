import { shouldCollapseIdentity } from './identityHeaderMotion';
import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

export interface HeaderIdentity {
  name: string;
  seed: string;
  picture?: string | null;
}

/** A single compact row fits native iOS bars and the Android sheet title slot. */
export function IdentityHeader({ name, seed, picture }: HeaderIdentity) {
  return (
    <View className="max-w-[220px] flex-row items-center gap-2">
      <Avatar
        state={picture ? 'image' : 'fallback'}
        picture={picture ?? undefined}
        seed={seed}
        size={28}
        alt={name}
      />
      <Text bold size={16} numberOfLines={1} className="shrink">
        {name}
      </Text>
    </View>
  );
}

function MorphTitle({
  identity,
  title,
  progress,
}: {
  identity?: HeaderIdentity;
  title: string;
  progress: SharedValue<number>;
}) {
  const foreground = useThemeColor('foreground');
  const identityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(progress.get(), [0.5, 1], [6, 0], Extrapolation.CLAMP) }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <View
      className="min-h-8 max-w-[220px] items-center justify-center"
      accessible
      accessibilityRole="header"
      accessibilityLabel={identity?.name ?? title}>
      <Animated.View className="absolute" style={titleStyle}>
        <Text size={16} bold color={foreground} numberOfLines={1}>
          {title}
        </Text>
      </Animated.View>
      <Animated.View style={identityStyle}>
        {identity ? (
          <IdentityHeader {...identity} />
        ) : (
          <Text size={16} bold>
            {title}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

/** Connected Apps' two-phase handoff, shared by every identity screen.
 * Hysteresis prevents threshold jitter; withTiming honors system reduced motion.
 * Supply a measured identity bottom relative to the unobscured scroll viewport
 * when the identity is not the first 64pt avatar in the page.
 */
export function useIdentityHeader({
  identity,
  title = '',
  collapseAt = 76,
}: {
  identity?: HeaderIdentity;
  title?: string;
  collapseAt?: number;
}) {
  const scrollY = useSharedValue(0);
  const progress = useSharedValue(0);
  const flipped = useSharedValue(false);
  const enabled = identity !== undefined;
  useAnimatedReaction(
    () => scrollY.get(),
    (y) => {
      const next = shouldCollapseIdentity(y, flipped.get(), collapseAt, enabled);
      if (next === flipped.get()) return;
      flipped.set(next);
      progress.set(withTiming(next ? 1 : 0, { duration: 200 }));
    },
    [enabled, collapseAt]
  );
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  const headerGradientStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const animatedOnScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(Math.max(0, event.contentOffset.y));
  });
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.set(Math.max(0, event.nativeEvent.contentOffset.y));
  };
  return {
    scrollY,
    onScroll,
    animatedOnScroll,
    contentStyle,
    headerGradientStyle,
    headerTitle: () => <MorphTitle identity={identity} title={title} progress={progress} />,
    probe: __DEV__ ? <IdentityHeaderProbe flipped={flipped} /> : null,
  };
}

/** Development evidence updates locally; an identity handoff never rerenders its page. */
function IdentityHeaderProbe({ flipped }: { flipped: SharedValue<boolean> }) {
  const [collapsed, setCollapsed] = useState(false);
  useAnimatedReaction(
    () => flipped.get(),
    (next, previous) => {
      if (next !== previous) runOnJS(setCollapsed)(next);
    }
  );
  return (
    <E2EAccessibilityProbe
      testID={collapsed ? 'identity-header-collapsed' : 'identity-header-expanded'}
      accessibilityLabel={collapsed ? 'Identity in navigation header' : 'Identity in page'}
    />
  );
}
