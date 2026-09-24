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

import { HEADER_EDGE_INSET, useCenteredTitleMaxWidth } from '@/navigation/headerLayout';
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
  /** A mint draws `MintIcon`, so a missing or failed icon is the mint
   *  placeholder, not a seeded avatar. A provider draws the same seeded clay
   *  avatar a person does, as a machine — it publishes no icon of its own. */
  kind?: 'person' | 'mint' | 'provider';
  /** The picture is still resolving; draws the loading placeholder instead of a fallback. */
  isLoading?: boolean;
}

// Native navigation titles do not follow Dynamic Type, and the band shares a
// fixed row under the bar. The bar's title view carries the full name.
const NAME_MAX_FONT_SCALE = 1.2;

/** The identity's picture at whatever diameter its header shape allows. */
function IdentityIcon({
  name,
  seed,
  picture,
  kind = 'person',
  isLoading = false,
  size,
}: HeaderIdentity & { size: number }) {
  return kind === 'mint' ? (
    <MintIcon iconUrl={picture} name={name} size={size} isLoading={isLoading} />
  ) : (
    <Avatar
      state={isLoading ? 'loading' : picture ? 'image' : 'fallback'}
      fallbackKind={kind === 'provider' ? 'robot' : 'person'}
      picture={picture ?? undefined}
      seed={seed}
      size={size}
      alt={name}
    />
  );
}

/**
 * The identity as the navigation bar shows it: the icon alone, at the same
 * diameter as every headerLeft/headerRight control. Every header that names a
 * person uses this — a scroll handoff and a chat header are the same thing at
 * rest, so neither gets its own size. The name it displaces rides in
 * {@link IdentityNameBand} directly below the bar.
 */
export function IdentityBarTitle({
  name,
  seed,
  picture,
  kind = 'person',
  isLoading = false,
}: HeaderIdentity) {
  return (
    <View
      className="items-center justify-center"
      style={BAR_TITLE_STYLE}
      accessible
      accessibilityRole="header"
      accessibilityLabel={name}>
      <IdentityIcon
        name={name}
        seed={seed}
        picture={picture}
        kind={kind}
        isLoading={isLoading}
        size={headerIdentity.barIconSize}
      />
    </View>
  );
}

const BAR_TITLE_STYLE = {
  height: headerIdentity.height,
  width: headerIdentity.barIconSize,
};

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
          <IdentityIcon {...identity} size={headerIdentity.barIconSize} />
        ) : (
          <Text size={16} bold numberOfLines={1}>
            {title}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

const BAND_STYLE = { height: headerIdentity.bandHeight, marginTop: -headerIdentity.bandPullUp };
const BAND_NAME_STYLE = {
  lineHeight: headerIdentity.bandNameLineHeight,
  paddingHorizontal: HEADER_EDGE_INSET,
};

/**
 * The collapsed identity's name, pinned directly under the bar.
 *
 * The bar itself has no room for it — the icon now fills the row at button
 * size, and neither platform exposes a native header subtitle — so the name
 * becomes header chrome one line lower. It draws no scrim of its own: the
 * screen's existing header gradient is the only chrome here, and a second ramp
 * under it only ever read as a misplaced slab. `Screen` overlays the band
 * without reserving layout, so an unscrolled page is unchanged. The bar's title
 * view already announces the name, so this copy stays out of the accessibility
 * tree.
 */
export function IdentityNameBand({
  name,
  progress,
  nameTestID,
}: {
  name: string;
  /** Fades the band in with a scroll handoff. Omit on a header that always names its person. */
  progress?: SharedValue<number>;
  nameTestID?: string;
}) {
  const style = useAnimatedStyle(() => ({ opacity: progress ? progress.get() : 1 }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[BAND_STYLE, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Text
        bold
        size={headerIdentity.bandNameSize}
        numberOfLines={1}
        maxFontSizeMultiplier={NAME_MAX_FONT_SCALE}
        className="text-center"
        style={BAND_NAME_STYLE}
        testID={nameTestID}>
        {name}
      </Text>
    </Animated.View>
  );
}

/** Connected Apps' two-phase handoff, shared by every identity screen.
 * Hysteresis prevents threshold jitter; withTiming honors system reduced motion.
 * Supply a measured identity bottom relative to the unobscured scroll viewport
 * when the identity is not the first 64pt avatar in the page.
 *
 * The collapsed bar shows the icon alone at header-button size, so pass
 * `headerBand` to the page's `Screen` — that is where the name lands.
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
    /** Pass to `Screen`'s `headerBand`: the name the collapsed bar hands down a line. */
    headerBand: identity ? <IdentityNameBand name={identity.name} progress={progress} /> : null,
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
