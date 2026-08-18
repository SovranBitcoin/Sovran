import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import {
  LightningStrike,
  type LightningPalette,
} from '@/features/nearPay/components/LightningStrike';
import { NutDropCelebrationCanvas } from '@/features/nearPay/components/NutDropCelebrationCanvas';
import {
  getCelebrationCenterRect,
  getSharedAvatarTransform,
  type AvatarRect,
} from '@/features/nearPay/lib/avatarTransition';
import type { CelebrationPhase } from '@/features/nearPay/lib/nutDropCelebration';
import type { StrikeStatus } from '@/features/nearPay/lib/nutDropStrikeState';
import type { PeerLayoutSize } from '@/features/nearPay/lib/peerLayout';
import { peerAvatarState } from '@/features/nearPay/lib/peerProfile';
import { formatAmount } from '@/shared/lib/currency';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { alpha, duration, spacing, zIndex } from '@/shared/styles/tokens';

/**
 * Full-screen receive celebration: the sender's avatar flies from its radar
 * slot to center stage behind a dimming scrim, gold sky bolts strike it on
 * arrival (the impact frame — the hook fires the success haptic at the same
 * phase flip), the amount reveals, and the whole stage dissolves in place.
 *
 * Driven entirely by the celebration reducer's `phase` — this component
 * renders the act it is told to; the hook owns the beat clock. Tapping
 * anywhere skips to the return flight: ceremony never blocks interaction,
 * and money truth (toast + history) never depends on it.
 */

const CELEBRATION_AVATAR_SIZE = 96;
/**
 * One knob for every lightning surface on the radar (celebration canvas,
 * the flying avatar's strike, and the node-level edge-case strikes in
 * NearPayScreen). Edit + Metro reload to experiment.
 */
export const CELEBRATION_LIGHTNING_PALETTE: LightningPalette = 'storm-gold';
/** Beat lengths — consumed by useNutDropCelebration's phase scheduler. */
export const CELEBRATION_CENTERING_MS = duration.standard;
/**
 * The payoff act — the amount is on screen here, so it runs past the top
 * of the duration scale (loop + slow, a deliberate composition: the scale
 * caps at 1500ms and the read window earns more).
 */
export const CELEBRATION_HOLD_MS = duration.loop + duration.slow;
export const CELEBRATION_HOLD_ABBREVIATED_MS = duration.spin;
/**
 * The exit act dissolves in place — the focus is never undone spatially;
 * the centered avatar, amount, and scrim all fade out together while the
 * radar node returns underneath.
 */
export const CELEBRATION_EXIT_MS = duration.slow;
/**
 * Safety cap for the 'awaiting' act (avatar parked center-stage while the
 * redeem runs). The strike layer normally ends the wait first — success or
 * its own max-active failure — this only guards against a vanished entry.
 */
export const CELEBRATION_AWAITING_TIMEOUT_MS = 10_000;

const PHASE_STRIKE_STATUS: Record<Exclude<CelebrationPhase, 'idle'>, StrikeStatus> = {
  centering: 'active',
  awaiting: 'active',
  held: 'success',
  returning: 'fading',
};

export interface CelebrationPeerIdentity {
  peerID: string;
  /** '' when the sender vanished from announce state — copy omits the name. */
  name: string;
  avatarUrl: string | null;
  profileLoading: boolean;
}

export function NutDropCelebrationOverlay({
  peer,
  amount,
  unit,
  phase,
  sourceRect,
  containerSize,
  topInset,
  bottomAvoidance,
  onSkip,
}: {
  peer: CelebrationPeerIdentity;
  /** Null while the redeem is still running ('centering'/'awaiting'). */
  amount: number | null;
  unit: string;
  phase: Exclude<CelebrationPhase, 'idle'>;
  /** Radar rect captured at fire time; null = sender off-radar (fade in). */
  sourceRect: AvatarRect | null;
  containerSize: PeerLayoutSize;
  topInset: number;
  bottomAvoidance: number;
  onSkip: () => void;
}) {
  const background = useThemeColor('background');
  const foreground = useThemeColor('foreground');

  const centerRect = useMemo(
    () =>
      getCelebrationCenterRect({
        containerSize,
        avatarSize: CELEBRATION_AVATAR_SIZE,
        topInset,
        bottomAvoidance,
      }),
    [bottomAvoidance, containerSize, topInset]
  );

  const avatarX = useSharedValue(0);
  const avatarY = useSharedValue(0);
  const avatarScale = useSharedValue(1);
  const avatarOpacity = useSharedValue(0);
  const scrimOpacity = useSharedValue(0);
  const labelOpacity = useSharedValue(0);
  const labelTranslateY = useSharedValue<number>(spacing.sm);
  const enteredRef = useRef(false);

  const allValues = useMemo(
    () => [
      avatarX,
      avatarY,
      avatarScale,
      avatarOpacity,
      scrimOpacity,
      labelOpacity,
      labelTranslateY,
    ],
    [avatarOpacity, avatarScale, avatarX, avatarY, labelOpacity, labelTranslateY, scrimOpacity]
  );

  useEffect(() => {
    if (!centerRect) return;
    const centerTransform = getSharedAvatarTransform(centerRect, CELEBRATION_AVATAR_SIZE);
    const flightTiming = { duration: CELEBRATION_CENTERING_MS, easing: Easing.out(Easing.cubic) };

    if (phase === 'centering') {
      if (!enteredRef.current) {
        enteredRef.current = true;
        if (sourceRect) {
          const start = getSharedAvatarTransform(sourceRect, CELEBRATION_AVATAR_SIZE);
          avatarX.set(start.x);
          avatarY.set(start.y);
          avatarScale.set(start.scale);
          avatarOpacity.set(1);
        } else {
          // Sender no longer on the radar: materialize at center instead.
          avatarX.set(centerTransform.x);
          avatarY.set(centerTransform.y);
          avatarScale.set(0.7);
          avatarOpacity.set(0);
        }
      }
      avatarX.set(withTiming(centerTransform.x, flightTiming));
      avatarY.set(withTiming(centerTransform.y, flightTiming));
      avatarScale.set(withTiming(1, flightTiming));
      avatarOpacity.set(withTiming(1, flightTiming));
      scrimOpacity.set(
        withTiming(alpha.strong, { duration: duration.standard, easing: Easing.out(Easing.quad) })
      );
      return;
    }

    if (phase === 'awaiting') {
      // Parked center-stage, gold crackle running — nothing new to animate;
      // the strike layer ends this act (success → impact, failure → return).
      return;
    }

    if (phase === 'held') {
      // Amount reveal rides just behind the impact frame.
      const revealTiming = { duration: duration.quick, easing: Easing.out(Easing.cubic) };
      labelOpacity.set(withDelay(80, withTiming(1, revealTiming)));
      labelTranslateY.set(withDelay(80, withTiming(0, revealTiming)));
      return;
    }

    // 'returning' — dissolve in place: the center focus is never undone
    // spatially. Avatar, amount, and scrim fade together; the radar node
    // un-hides underneath when the overlay unmounts.
    const exitTiming = { duration: CELEBRATION_EXIT_MS, easing: Easing.in(Easing.quad) };
    avatarOpacity.set(withTiming(0, exitTiming));
    scrimOpacity.set(
      withTiming(0, { duration: CELEBRATION_EXIT_MS, easing: Easing.out(Easing.quad) })
    );
    labelOpacity.set(withTiming(0, exitTiming));
  }, [
    avatarOpacity,
    avatarScale,
    avatarX,
    avatarY,
    centerRect,
    labelOpacity,
    labelTranslateY,
    phase,
    scrimOpacity,
    sourceRect,
  ]);

  useEffect(() => {
    return () => {
      for (const value of allValues) cancelAnimation(value);
    };
  }, [allValues]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.get() }));
  const avatarStyle = useAnimatedStyle(() => ({
    opacity: avatarOpacity.get(),
    transform: [
      { translateX: avatarX.get() },
      { translateY: avatarY.get() },
      { scale: avatarScale.get() },
    ],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.get(),
    transform: [{ translateY: labelTranslateY.get() }],
  }));

  const scrimCombinedStyle = useMemo(
    () => [styles.scrim, { backgroundColor: background }, scrimStyle],
    [background, scrimStyle]
  );
  const avatarCombinedStyle = useMemo(() => [styles.avatar, avatarStyle], [avatarStyle]);
  const labelContainerStyle = useMemo(
    () =>
      centerRect
        ? [
            styles.labelContainer,
            { top: centerRect.y + CELEBRATION_AVATAR_SIZE + spacing.lg },
            labelStyle,
          ]
        : null,
    [centerRect, labelStyle]
  );
  const receivedTextStyle = useMemo(() => ({ color: foreground }), [foreground]);
  const fromTextStyle = useMemo(() => ({ color: opacity(foreground, alpha.muted) }), [foreground]);
  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  if (!centerRect) return null;

  return (
    <View
      style={styles.container}
      pointerEvents={phase === 'returning' ? 'none' : 'auto'}
      testID="nut-drop-celebration">
      <Animated.View pointerEvents="none" style={scrimCombinedStyle} />
      <NutDropCelebrationCanvas
        fieldSize={containerSize}
        targetX={centerRect.x + CELEBRATION_AVATAR_SIZE / 2}
        targetY={centerRect.y + CELEBRATION_AVATAR_SIZE / 2}
        avatarRadius={CELEBRATION_AVATAR_SIZE / 2}
        seed={peer.peerID}
        phase={phase}
        palette={CELEBRATION_LIGHTNING_PALETTE}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip celebration"
        style={StyleSheet.absoluteFill}
        onPress={handleSkip}
      />
      <Animated.View pointerEvents="none" style={avatarCombinedStyle}>
        <View pointerEvents="none" style={styles.avatarFrame}>
          <Avatar
            state={peerAvatarState(peer)}
            picture={peer.avatarUrl ?? undefined}
            size={CELEBRATION_AVATAR_SIZE}
            name={peer.name || 'Nearby peer'}
            seed={peer.peerID}
            alt={`${peer.name || 'Nearby peer'} avatar`}
          />
          <LightningStrike
            status={PHASE_STRIKE_STATUS[phase]}
            entrance="ambient"
            seed={peer.peerID}
            frameSize={CELEBRATION_AVATAR_SIZE}
            palette={CELEBRATION_LIGHTNING_PALETTE}
          />
        </View>
      </Animated.View>
      {labelContainerStyle && amount !== null ? (
        <Animated.View pointerEvents="none" style={labelContainerStyle}>
          <Text size={20} weight="bold" style={receivedTextStyle}>
            Received {formatAmount({ amount, unit }, { currencyDisplay: 'name' })}
          </Text>
          {peer.name ? (
            <Text size={13} weight="medium" style={fromTextStyle}>
              from {peer.name}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: zIndex.overlay,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  avatar: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CELEBRATION_AVATAR_SIZE,
    height: CELEBRATION_AVATAR_SIZE,
  },
  avatarFrame: {
    position: 'relative',
    width: CELEBRATION_AVATAR_SIZE,
    height: CELEBRATION_AVATAR_SIZE,
  },
  labelContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.xs,
  },
});
