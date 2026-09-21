import { shouldCollapseIdentity } from './identityHeaderMotion';
import { useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useCenteredTitleMaxWidth } from '@/navigation/headerLayout';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { headerIdentity } from '@/shared/styles/tokens';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

export interface HeaderIdentity {
  name: string;
  seed: string;
  picture?: string | null;
  /** A mint draws `MintIcon`, so a missing or failed icon is the mint placeholder, not a seeded avatar. */
  kind?: 'person' | 'mint';
  /** The picture is still resolving; draws the loading placeholder instead of a fallback. */
  isLoading?: boolean;
}

interface IdentityHeaderProps extends HeaderIdentity {
  /** The larger number of header actions on either side of the title (see `useCenteredTitleMaxWidth`). */
  sideActions?: number;
  nameTestID?: string;
}

const NAME_STYLE = { lineHeight: headerIdentity.nameLineHeight };
// Native navigation titles do not follow Dynamic Type, and this one shares a fixed
// row with the header buttons. The accessibility label carries the full name.
const NAME_MAX_FONT_SCALE = 1.2;

/** Icon above name, inside the header-button box, so every identity page centres alike. */
export function IdentityHeader({
  name,
  seed,
  picture,
  kind = 'person',
  isLoading = false,
  sideActions,
  nameTestID,
}: IdentityHeaderProps) {
  const maxWidth = useCenteredTitleMaxWidth(sideActions);
  const boxStyle = { maxWidth, height: headerIdentity.height, gap: headerIdentity.gap };
  return (
    <View className="items-center justify-center" style={boxStyle}>
      {kind === 'mint' ? (
        <MintIcon
          iconUrl={picture}
          name={name}
          size={headerIdentity.iconSize}
          isLoading={isLoading}
        />
      ) : (
        <Avatar
          state={isLoading ? 'loading' : picture ? 'image' : 'fallback'}
          picture={picture ?? undefined}
          seed={seed}
          size={headerIdentity.iconSize}
          alt={name}
        />
      )}
      <Text
        bold
        size={headerIdentity.nameSize}
        numberOfLines={1}
        maxFontSizeMultiplier={NAME_MAX_FONT_SCALE}
        className="max-w-full text-center"
        style={NAME_STYLE}
        testID={nameTestID}>
        {name}
      </Text>
    </View>
  );
}

function MorphTitle({
  identity,
  title,
  sideActions,
  progress,
}: {
  identity?: HeaderIdentity;
  title: string;
  sideActions?: number;
  progress: SharedValue<number>;
}) {
  const foreground = useThemeColor('foreground');
  const maxWidth = useCenteredTitleMaxWidth(sideActions);
  const boxStyle = { maxWidth, height: headerIdentity.height };
  const identityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(progress.get(), [0.5, 1], [6, 0], Extrapolation.CLAMP) }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <View
      className="items-center justify-center"
      style={boxStyle}
      accessible
      accessibilityRole="header"
      accessibilityLabel={identity?.name ?? title}>
      {/* The title is an overlay, so this zero-height copy is what gives the box
          the title's width: Android's native header subview clips content to the
          box, and the identity stack alone is narrower than most titles. */}
      <Text size={16} bold numberOfLines={1} aria-hidden className="h-0 opacity-0">
        {title}
      </Text>
      <Animated.View className="absolute max-w-full" style={titleStyle}>
        <Text size={16} bold color={foreground} numberOfLines={1}>
          {title}
        </Text>
      </Animated.View>
      <Animated.View className="max-w-full" style={identityStyle}>
        {identity ? (
          <IdentityHeader {...identity} sideActions={sideActions} />
        ) : (
          <Text size={16} bold numberOfLines={1}>
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
  sideActions,
}: {
  identity?: HeaderIdentity;
  title?: string;
  collapseAt?: number;
  /** The larger number of header actions on either side; bounds the title so it stays centred. */
  sideActions?: number;
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
    headerTitle: () => (
      <MorphTitle identity={identity} title={title} sideActions={sideActions} progress={progress} />
    ),
    probe: __DEV__ ? <IdentityHeaderProbe flipped={flipped} /> : null,
  };
}

/** Development evidence updates locally; an identity handoff never rerenders its page. */
function IdentityHeaderProbe({ flipped }: { flipped: SharedValue<boolean> }) {
  const [collapsed, setCollapsed] = useState(false);
  useAnimatedReaction(
    () => flipped.get(),
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setCollapsed, next);
    }
  );
  return (
    <E2EAccessibilityProbe
      testID={collapsed ? 'identity-header-collapsed' : 'identity-header-expanded'}
      accessibilityLabel={collapsed ? 'Identity in navigation header' : 'Identity in page'}
    />
  );
}
