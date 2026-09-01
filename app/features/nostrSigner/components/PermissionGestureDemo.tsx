/**
 * @fileoverview Looping gesture demo for the permission editor
 *
 * A floating pointer hand — the familiar down-pointing "hand cursor" glyph —
 * demonstrates the permission-row gestures on a miniature mock row: tap
 * toggles the switch (Ask ↔ Always), a long-press grows a hold ring, the
 * Allow/Ask/Block mini menu pops in, the hand taps Block, and the row flips
 * to the red blocked state — then everything resets behind a fade and loops.
 *
 * Monochrome by design: every element draws with foreground/background/muted
 * tokens (reads black & white in both themes); the ONLY color is danger red
 * at the block reveal. The mock row sits on a perspective-tilted plane that
 * leans toward the press point, with the glove floating on its own layer for
 * parallax — deliberately dimensional rather than a flat mock.
 *
 * All motion derives from ONE master millisecond clock (`t`) sampled through
 * the keyframe tracks in permissionGestureDemo.timeline.ts — elements can
 * never drift apart, the loop seam is exact (tested), and everything runs on
 * the UI thread. The clock starts on screen focus, stops on blur, and never
 * starts at all under Reduce Motion (the t=0 idle frame + caption stand in).
 */

import React, { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { withAlpha } from '@/shared/lib/color';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import Icon from 'assets/icons';
import {
  BOB_AMP,
  BOB_PERIOD_MS,
  CYCLE_MS,
  DEMO_TRACKS,
  PRESS_X,
  PRESS_Y,
  ROW_H,
  ROW_LEFT,
  ROW_TOP,
  ROW_W,
  RX_IDLE,
  RY_IDLE,
  SCENE_H,
  SCENE_W,
  valueAt,
  type EasingMap,
  type Track,
} from '@/features/nostrSigner/components/permissionGestureDemo.timeline';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const {
  GLOVE_X,
  GLOVE_Y,
  GLOVE_SCALE_X,
  GLOVE_SCALE_Y,
  GLOVE_ROTATE_DEG,
  BOB_WEIGHT,
  SHADOW_OPACITY,
  SHADOW_SCALE_X,
  ROW_RX,
  ROW_RY,
  ROW_DEPRESS,
  ROW_THUNK_SCALE,
  ROW_FADE,
  KNOB_X,
  TRACK_ON,
  RED_P,
  STATUS_ASK,
  STATUS_ALWAYS,
  STATUS_BLOCKED,
  RING_OPACITY,
  RING_SWEEP,
  RING_SCALE,
  MENU_SCALE,
  MENU_OPACITY,
  MENU_ROW_IN,
  BLOCK_FLASH,
  WORD_TAP_1,
  WORD_TAP_2,
  WORD_HOLD,
  WORD_BLOCK,
} = DEMO_TRACKS;

// Easing.bezierFn (not Easing.bezier) — the Fn variant is directly callable
// inside worklets; the plain one returns a factory for withTiming configs.
const EASINGS: EasingMap = {
  linear: Easing.linear,
  outCubic: Easing.out(Easing.cubic),
  inQuad: Easing.in(Easing.quad),
  outQuad: Easing.out(Easing.quad),
  overshoot: Easing.bezierFn(0.34, 1.56, 0.64, 1),
  inOutSin: Easing.inOut(Easing.sin),
};

const MOCK_TITLE = 'Post publicly'; // mirrors the first real bundle row below

/**
 * Beat-synced callouts — playful, one per gesture beat. Rendered in the
 * LuckiestGuy-Subset display font (all-caps title-card style); the subset
 * ships ONLY these words' letters, so new wording needs a re-subset (see
 * shared/hooks/useFonts.ts).
 */
const WORD_TAP_1_TEXT = 'Tap!';
const WORD_TAP_2_TEXT = 'Tap again!';
const WORD_HOLD_TEXT = 'Hold\u2026';
const WORD_BLOCK_TEXT = 'Block!';
const WORD_FONT = 'LuckiestGuy-Subset';
/** Static stand-in when Reduce Motion keeps the clock stopped. */
const REDUCED_MOTION_CAPTION = 'Tap to toggle · Hold for more options';
const A11Y_LABEL = 'Demo: tap a permission to toggle Allow. Hold for Ask, Allow, or Block.';

// ── Hand geometry ───────────────────────────────────────────────
// fa6-solid:hand-point-down is a 384×512 glyph whose fingertip sits at
// (64, 512) — the bottom of the index-finger bar; the anchor scales with it.
const HAND_VB_W = 384;
const HAND_VB_H = 512;
const GLOVE_W = 37.5;
const GLOVE_H = 50;
const TIP_X = (64 * GLOVE_W) / HAND_VB_W;
const TIP_Y = (512 * GLOVE_H) / HAND_VB_H;
/** Pivot offsets so squash/rotate hinge AT the fingertip (both axes) — the
 *  finger sits bottom-left of this glyph, far from the view center. */
const TIP_PIVOT_X = TIP_X - GLOVE_W / 2;
const TIP_PIVOT_Y = TIP_Y - GLOVE_H / 2;

const RING_R = 10;
const RING_BOX = 26;
const RING_C = 2 * Math.PI * RING_R;

const MENU_LEFT = 148;
const MENU_TOP = 6;
const MENU_W = 96;
const MENU_H = 72;
const MENU_ROW_H = 22;
const MENU_ICONS = ['mdi:check-circle', 'mdi:help-circle', 'mdi:cancel'] as const;

// ── Static styles ───────────────────────────────────────────────
// The hand rises to 26 above the scene top at the menu-hover pose
// (fingertip y 30 − hand height 56); the stage pads that headroom so the
// card's overflow-hidden never clips it.
const GLOVE_HEADROOM = 28;
const CARD_STYLE = { height: SCENE_H + GLOVE_HEADROOM + 4 } as const;
const REDUCED_MOTION_CARD_STYLE = { height: SCENE_H + GLOVE_HEADROOM + 28 } as const;
const STAGE_STYLE = {
  height: SCENE_H + GLOVE_HEADROOM,
  alignItems: 'center',
  paddingTop: GLOVE_HEADROOM,
} as const;
const SCENE_STYLE = { width: SCENE_W, height: SCENE_H } as const;
const ROW_PLANE_BASE = {
  position: 'absolute',
  left: ROW_LEFT,
  top: ROW_TOP,
  width: ROW_W,
  height: ROW_H,
  borderRadius: 14,
  borderCurve: 'continuous',
} as const;
const ROW_CONTENT_STYLE = {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 14,
} as const;
const STATUS_STACK_STYLE = { marginTop: 1 } as const;
const STATUS_ABS_STYLE = { position: 'absolute', left: 0, top: 0 } as const;
const SWITCH_TRACK_STYLE = { width: 36, height: 22, borderRadius: 11 } as const;
const SWITCH_KNOB_BASE = {
  position: 'absolute',
  left: 2,
  top: 2,
  width: 18,
  height: 18,
  borderRadius: 9,
  borderWidth: 1,
} as const;
const SHADOW_BASE = {
  position: 'absolute',
  left: 0,
  top: 86,
  width: 36,
  height: 9,
  borderRadius: 999,
} as const;
const RING_WRAP_BASE = {
  position: 'absolute',
  left: PRESS_X - RING_BOX / 2,
  top: PRESS_Y - RING_BOX / 2,
  width: RING_BOX,
  height: RING_BOX,
} as const;
const MENU_BASE = {
  position: 'absolute',
  left: MENU_LEFT,
  top: MENU_TOP,
  width: MENU_W,
  height: MENU_H,
  borderRadius: 10,
  borderWidth: 1,
  paddingVertical: 3,
} as const;
const MENU_ROW_STYLE = {
  height: MENU_ROW_H,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 8,
} as const;
const MENU_BAR_STYLE = { width: 40, height: 3, borderRadius: 2 } as const;
const BLOCK_FLASH_BASE = {
  position: 'absolute',
  left: 2,
  right: 2,
  top: 3 + 2 * MENU_ROW_H,
  height: MENU_ROW_H,
  borderRadius: 7,
} as const;
const GLOVE_BASE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: GLOVE_W,
  height: GLOVE_H,
} as const;
/** Hand + its shadow live on an explicitly zIndexed layer: document order
 *  alone is not enough — the SVG overlays (hold ring's animatedProps circle,
 *  menu icons) can composite above later siblings, putting stray strokes on
 *  top of the hand. */
const HAND_LAYER_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: SCENE_W,
  height: SCENE_H,
  zIndex: 10,
} as const;
const CAPTION_STYLE = { textAlign: 'center' } as const;
const INVISIBLE_STYLE = { opacity: 0 } as const;
/** Beat words: flush with the mock row's left edge, vertically centered in
 *  the gap above it (scene top → row top), slightly tilted — title-card
 *  energy. The fixed-height centering box also makes the pop scale about the
 *  gap's center. */
const WORD_BASE = {
  position: 'absolute',
  left: ROW_LEFT,
  top: 0,
  height: ROW_TOP,
  justifyContent: 'center',
} as const;
/** Single-weight display font — no `bold` (faux-bold distorts it on Android). */
const WORD_TEXT_STYLE = { fontFamily: WORD_FONT } as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The familiar pointer hand, down-pointing (fa6-solid:hand-point-down,
 * Font Awesome Free / CC BY 4.0 — solid silhouette, the classic cursor
 * look). All motion comes from the parent Animated.View.
 */
function GloveHand({ fg }: { fg: string }) {
  return (
    <Svg width={GLOVE_W} height={GLOVE_H} viewBox="0 0 384 512">
      <Path
        d="M32 480c0 17.7 14.3 32 32 32s32-14.3 32-32V272H32zm192-160c0 17.7 14.3 32 32 32s32-14.3 32-32v-64c0-17.7-14.3-32-32-32s-32 14.3-32 32zm-64 64c17.7 0 32-14.3 32-32v-48c0-17.7-14.3-32-32-32s-32 14.3-32 32v48c0 17.7 14.3 32 32 32m160-96c0 17.7 14.3 32 32 32s32-14.3 32-32v-64c0-17.7-14.3-32-32-32s-32 14.3-32 32zm-96-88v.6c9.4-5.4 20.3-8.6 32-8.6c13.2 0 25.4 4 35.6 10.8c8.7-24.9 32.5-42.8 60.4-42.8c11.7 0 22.6 3.1 32 8.6V160C384 71.6 312.4 0 224 0h-61.7C119.8 0 79.1 16.9 49.1 46.9L37.5 58.5C13.5 82.5 0 115.1 0 149v27c0 35.3 28.7 64 64 64h88c22.1 0 40-17.9 40-40s-17.9-40-40-40H96c-8.8 0-16-7.2-16-16s7.2-16 16-16h56c39.8 0 72 32.2 72 72"
        fill={fg}
      />
    </Svg>
  );
}

/** Stagger helper — row i samples the shared entrance track 60 ms later. */
function useMenuRowStyle(t: SharedValue<number>, index: number) {
  return useAnimatedStyle(() => {
    const v = valueAt(t.get() - 60 * index, MENU_ROW_IN, EASINGS);
    return { opacity: v, transform: [{ translateY: (1 - v) * 4 }] };
  });
}

/** Beat-word pop: the overshoot easing carries v past 1 for the bounce. */
function useWordStyle(t: SharedValue<number>, track: Track) {
  return useAnimatedStyle(() => {
    const v = valueAt(t.get(), track, EASINGS);
    return {
      opacity: Math.min(v, 1),
      transform: [{ rotate: '-3deg' }, { scale: 0.6 + 0.4 * v }],
    };
  });
}

export function PermissionGestureDemo(): React.ReactElement {
  const [foreground, background, muted, danger] = useThemeColor([
    'foreground',
    'background',
    'muted',
    'danger',
  ] as const);
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      if (reducedMotion) return undefined;
      t.set(0);
      t.set(
        withRepeat(withTiming(CYCLE_MS, { duration: CYCLE_MS, easing: Easing.linear }), -1, false)
      );
      return () => {
        cancelAnimation(t);
        t.set(0);
      };
    }, [reducedMotion, t])
  );

  // Theme-derived plain strings, captured by the worklets below.
  const rowFill = withAlpha(foreground, 0.06);
  const trackOff = withAlpha(foreground, 0.15);
  const knobBorder = withAlpha(foreground, 0.2);
  const menuBorder = withAlpha(foreground, 0.15);
  const menuBar = withAlpha(foreground, 0.35);

  const gloveStyle = useAnimatedStyle(() => {
    const bob =
      BOB_AMP *
      Math.sin((2 * Math.PI * t.get()) / BOB_PERIOD_MS) *
      valueAt(t.get(), BOB_WEIGHT, EASINGS);
    return {
      transform: [
        { translateX: valueAt(t.get(), GLOVE_X, EASINGS) - TIP_X },
        { translateY: valueAt(t.get(), GLOVE_Y, EASINGS) - TIP_Y + bob },
        // Pivot sandwich: squash/rotate hinge at the fingertip on BOTH axes,
        // so the tip stays planted on the press point through every pose.
        { translateX: TIP_PIVOT_X },
        { translateY: TIP_PIVOT_Y },
        { rotate: `${valueAt(t.get(), GLOVE_ROTATE_DEG, EASINGS)}deg` },
        { scaleX: valueAt(t.get(), GLOVE_SCALE_X, EASINGS) },
        { scaleY: valueAt(t.get(), GLOVE_SCALE_Y, EASINGS) },
        { translateY: -TIP_PIVOT_Y },
        { translateX: -TIP_PIVOT_X },
      ],
    };
  });

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), SHADOW_OPACITY, EASINGS),
    transform: [
      { translateX: valueAt(t.get(), GLOVE_X, EASINGS) - 18 },
      { scaleX: valueAt(t.get(), SHADOW_SCALE_X, EASINGS) },
    ],
  }));

  const rowPlaneStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), ROW_FADE, EASINGS),
    transform: [
      { perspective: 800 },
      { rotateX: `${valueAt(t.get(), ROW_RX, EASINGS)}deg` },
      { rotateY: `${valueAt(t.get(), ROW_RY, EASINGS)}deg` },
      { translateY: valueAt(t.get(), ROW_DEPRESS, EASINGS) },
      { scale: valueAt(t.get(), ROW_THUNK_SCALE, EASINGS) },
    ],
  }));

  // Content floats a hair above the card base: counter-translate vs tilt.
  const rowContentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (valueAt(t.get(), ROW_RY, EASINGS) - RY_IDLE) * 0.5 },
      { translateY: (valueAt(t.get(), ROW_RX, EASINGS) - RX_IDLE) * 0.4 },
    ],
  }));

  const titleBaseStyle = useAnimatedStyle(() => ({
    opacity: 1 - valueAt(t.get(), RED_P, EASINGS),
  }));
  const titleDangerStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), RED_P, EASINGS),
  }));
  const statusAskStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), STATUS_ASK, EASINGS),
  }));
  const statusAlwaysStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), STATUS_ALWAYS, EASINGS),
  }));
  const statusBlockedStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), STATUS_BLOCKED, EASINGS),
  }));

  const switchTrackStyle = useAnimatedStyle(() => {
    const base = interpolateColor(
      valueAt(t.get(), TRACK_ON, EASINGS),
      [0, 1],
      [trackOff, foreground]
    );
    return {
      backgroundColor: interpolateColor(valueAt(t.get(), RED_P, EASINGS), [0, 1], [base, danger]),
    };
  });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: valueAt(t.get(), KNOB_X, EASINGS) }],
  }));

  const ringWrapStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), RING_OPACITY, EASINGS),
    transform: [{ rotate: '-90deg' }, { scale: valueAt(t.get(), RING_SCALE, EASINGS) }],
  }));
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_C * (1 - valueAt(t.get(), RING_SWEEP, EASINGS)),
  }));

  const menuStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), MENU_OPACITY, EASINGS),
    transform: [
      // Pivot toward the press point below the card.
      { translateY: MENU_H / 2 },
      { scale: valueAt(t.get(), MENU_SCALE, EASINGS) },
      { translateY: -MENU_H / 2 },
    ],
  }));
  const menuRow0 = useMenuRowStyle(t, 0);
  const menuRow1 = useMenuRowStyle(t, 1);
  const menuRow2 = useMenuRowStyle(t, 2);

  const blockFlashStyle = useAnimatedStyle(() => ({
    opacity: valueAt(t.get(), BLOCK_FLASH, EASINGS),
  }));

  const wordTap1Style = useWordStyle(t, WORD_TAP_1);
  const wordTap2Style = useWordStyle(t, WORD_TAP_2);
  const wordHoldStyle = useWordStyle(t, WORD_HOLD);
  const wordBlockStyle = useWordStyle(t, WORD_BLOCK);

  // Composed style arrays as plain consts — React Compiler memoizes them
  // (animated style objects from useAnimatedStyle are reference-stable).
  const rowPlaneComposed = [ROW_PLANE_BASE, { backgroundColor: rowFill }, rowPlaneStyle];
  const rowContentComposed = [ROW_CONTENT_STYLE, rowContentStyle];
  const titleDangerComposed = [STATUS_ABS_STYLE, titleDangerStyle];
  const statusAskComposed = [STATUS_ABS_STYLE, statusAskStyle];
  const statusAlwaysComposed = [STATUS_ABS_STYLE, statusAlwaysStyle];
  const statusBlockedComposed = [STATUS_ABS_STYLE, statusBlockedStyle];
  const switchTrackComposed = [SWITCH_TRACK_STYLE, switchTrackStyle];
  const knobComposed = [
    SWITCH_KNOB_BASE,
    { backgroundColor: background, borderColor: knobBorder },
    knobStyle,
  ];
  const shadowComposed = [SHADOW_BASE, { backgroundColor: foreground }, shadowStyle];
  const ringWrapComposed = [RING_WRAP_BASE, ringWrapStyle];
  const menuComposed = [
    MENU_BASE,
    { backgroundColor: background, borderColor: menuBorder },
    menuStyle,
  ];
  const menuRowComposed = [
    [MENU_ROW_STYLE, menuRow0],
    [MENU_ROW_STYLE, menuRow1],
    [MENU_ROW_STYLE, menuRow2],
  ];
  const menuBarComposed = [MENU_BAR_STYLE, { backgroundColor: menuBar }];
  const blockFlashComposed = [BLOCK_FLASH_BASE, { backgroundColor: danger }, blockFlashStyle];
  const gloveComposed = [GLOVE_BASE, gloveStyle];
  const wordTap1Composed = [WORD_BASE, wordTap1Style];
  const wordTap2Composed = [WORD_BASE, wordTap2Style];
  const wordHoldComposed = [WORD_BASE, wordHoldStyle];
  const wordBlockComposed = [WORD_BASE, wordBlockStyle];

  return (
    <View
      className="bg-surface-secondary shadow-surface overflow-hidden rounded-3xl"
      style={reducedMotion ? REDUCED_MOTION_CARD_STYLE : CARD_STYLE}
      accessible
      accessibilityRole="image"
      accessibilityLabel={A11Y_LABEL}>
      <View
        style={STAGE_STYLE}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <View style={SCENE_STYLE}>
          {/* Mock permission row on its tilted plane */}
          <Animated.View style={rowPlaneComposed}>
            <Animated.View style={rowContentComposed}>
              <View>
                <View>
                  <Animated.View style={titleBaseStyle}>
                    <Text size={12} bold color={foreground} numberOfLines={1}>
                      {MOCK_TITLE}
                    </Text>
                  </Animated.View>
                  <Animated.View style={titleDangerComposed}>
                    <Text size={12} bold color={danger} numberOfLines={1}>
                      {MOCK_TITLE}
                    </Text>
                  </Animated.View>
                </View>
                <View style={STATUS_STACK_STYLE}>
                  {/* Invisible relative text sizes the stack; states overlay. */}
                  <Text size={10} color={muted} style={INVISIBLE_STYLE}>
                    Always
                  </Text>
                  <Animated.View style={statusAskComposed}>
                    <Text size={10} color={muted}>
                      Ask
                    </Text>
                  </Animated.View>
                  <Animated.View style={statusAlwaysComposed}>
                    <Text size={10} color={muted}>
                      Always
                    </Text>
                  </Animated.View>
                  <Animated.View style={statusBlockedComposed}>
                    <Text size={10} color={danger}>
                      Blocked
                    </Text>
                  </Animated.View>
                </View>
              </View>
              <Animated.View style={switchTrackComposed}>
                <Animated.View style={knobComposed} />
              </Animated.View>
            </Animated.View>
          </Animated.View>

          {/* Long-press hold ring */}
          <Animated.View style={ringWrapComposed}>
            <Svg width={RING_BOX} height={RING_BOX}>
              <AnimatedCircle
                cx={RING_BOX / 2}
                cy={RING_BOX / 2}
                r={RING_R}
                stroke={foreground}
                strokeWidth={2.5}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${RING_C}`}
                animatedProps={ringProps}
              />
            </Svg>
          </Animated.View>

          {/* Mini Allow / Ask / Block menu */}
          <Animated.View style={menuComposed}>
            {MENU_ICONS.map((iconName, index) => (
              <Animated.View key={iconName} style={menuRowComposed[index]}>
                <Icon name={iconName} size={11} color={foreground} />
                <View style={menuBarComposed} />
              </Animated.View>
            ))}
            <Animated.View style={blockFlashComposed} />
          </Animated.View>

          {/* Beat words — top-left title-card callouts, synced to the clock */}
          <Animated.View style={wordTap1Composed}>
            <Text size={26} color={foreground} style={WORD_TEXT_STYLE}>
              {WORD_TAP_1_TEXT}
            </Text>
          </Animated.View>
          <Animated.View style={wordTap2Composed}>
            <Text size={26} color={foreground} style={WORD_TEXT_STYLE}>
              {WORD_TAP_2_TEXT}
            </Text>
          </Animated.View>
          <Animated.View style={wordHoldComposed}>
            <Text size={26} color={foreground} style={WORD_TEXT_STYLE}>
              {WORD_HOLD_TEXT}
            </Text>
          </Animated.View>
          <Animated.View style={wordBlockComposed}>
            <Text size={26} color={danger} style={WORD_TEXT_STYLE}>
              {WORD_BLOCK_TEXT}
            </Text>
          </Animated.View>

          {/* Hand layer LAST and zIndexed — nothing may draw over the hand */}
          <View style={HAND_LAYER_STYLE}>
            <Animated.View style={shadowComposed} />
            <Animated.View style={gloveComposed}>
              <GloveHand fg={foreground} />
            </Animated.View>
          </View>
        </View>
      </View>
      {reducedMotion ? (
        <Text className="pb-2" size={12} color={muted} style={CAPTION_STYLE}>
          {REDUCED_MOTION_CAPTION}
        </Text>
      ) : null}
    </View>
  );
}
