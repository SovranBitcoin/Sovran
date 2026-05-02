/**
 * @fileoverview Horizontal snap carousel of participant cards.
 *
 * Shape + motion match `rn-makeitanimated/src/apps/(a-c)/apple-invites`
 * as closely as makes sense for a QR-bearing card:
 *   - Cards are 72% of screen width and stride at exactly card-width — no
 *     gap — so the left/right neighbours peek out from under the focused
 *     card the same way they do in the reference.
 *   - Tilt is ±0.6° pivoting around the card's bottom edge
 *     (`transformOrigin: 'bottom'`), reproducing the concave "fan" feel.
 *   - Parallax `translateY` is ±1 px: edges sit slightly lower, centre
 *     sits slightly higher (depth cue).
 *   - No scale. The reference doesn't scale and scaling made neighbour
 *     cards feel like they were in a different plane from the focused one.
 *   - Each card body has an 8 px margin so the rounded corners aren't
 *     flush with the next card (matches `p-2` on the reference's outer
 *     marquee item).
 *
 * Auto-scroll (`useFrameCallback`) is deliberately NOT used — the QR
 * needs to sit still to be scanned. Swipe-to-snap only.
 *
 * Exposes an imperative `scrollToIndex(i)` via `forwardRef` so the list
 * below can jump the deck when a row is tapped.
 */

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
} from 'react-native';
import Animated, {
  Extrapolation,
  SharedValue,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { View } from '@/shared/ui/primitives/View/View';
import type {
  SplitBillGroup,
  SplitBillParticipant,
} from '@/shared/stores/profile/splitBillTransactionsStore';
import { ParticipantCard } from './ParticipantCard';

const SCREEN_W = Dimensions.get('window').width;
// Match apple-invites: card stride = card width (no gap). The visual
// gap between card bodies comes from `ITEM_MARGIN` inside each slot,
// mirroring the reference's `p-2` wrapper.
const CARD_W = Math.round(SCREEN_W * 0.8);
const ITEM_MARGIN = 8;
const STEP = CARD_W;
const SIDE_PAD = (SCREEN_W - CARD_W) / 2;

export interface ParticipantCardDeckRef {
  /** Animate the deck to center `index`. */
  scrollToIndex: (index: number, animated?: boolean) => void;
}

interface ParticipantCardDeckProps {
  group: SplitBillGroup;
  /** Called whenever the focused card changes (at momentum end). */
  onFocusChange?: (index: number) => void;
  /** Called when the retry CTA inside a card is tapped. */
  onRetry?: (participantId: string) => void;
  /** Called when the "View" pill inside a card is tapped. */
  onView?: (participantId: string) => void;
}

interface DeckItemProps {
  group: SplitBillGroup;
  participant: SplitBillParticipant;
  index: number;
  scrollX: SharedValue<number>;
  onRetry?: (participantId: string) => void;
  onView?: (participantId: string) => void;
}

/**
 * One wrapped card. Keeps the animated-style logic isolated so
 * `useAnimatedStyle` is called at the top level of a component (hook rule).
 */
function DeckItem({ group, participant, index, scrollX, onRetry, onView }: DeckItemProps) {
  const animatedStyle = useAnimatedStyle(() => {
    // Signed offset: how far this card is from the focus point on the
    // scroll axis. +STEP = one card to the right of focus, -STEP = one
    // card to the left of focus, 0 = focused.
    const offset = index * STEP - scrollX.value;

    // Apple-invites values verbatim — a concave fan where neighbour cards
    // lean OUTWARD (away from centre) with their bottom edge pinned.
    const rotate = interpolate(
      offset,
      [-STEP, 0, STEP],
      [-0.6, 0, 0.6],
      Extrapolation.CLAMP
    );
    const translateY = interpolate(
      offset,
      [-STEP, 0, STEP],
      [1, -0.5, 1],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ translateY }, { rotateZ: `${rotate}deg` }],
    };
  }, [index]);

  return (
    <Animated.View style={[styles.item, animatedStyle]}>
      <ParticipantCard
        group={group}
        participant={participant}
        onRetry={onRetry}
        onView={onView}
      />
    </Animated.View>
  );
}

export const ParticipantCardDeck = forwardRef<ParticipantCardDeckRef, ParticipantCardDeckProps>(
  function ParticipantCardDeck({ group, onFocusChange, onRetry, onView }, ref) {
    const scrollRef = useRef<Animated.ScrollView>(null);
    const scrollX = useSharedValue(0);

    const scrollHandler = useAnimatedScrollHandler({
      onScroll: (e) => {
        scrollX.value = e.contentOffset.x;
      },
    });

    const handleMomentumEnd = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!onFocusChange) return;
        const idx = Math.round(e.nativeEvent.contentOffset.x / STEP);
        onFocusChange(Math.max(0, Math.min(idx, group.participants.length - 1)));
      },
      [group.participants.length, onFocusChange]
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex(index, animated = true) {
          scrollRef.current?.scrollTo({ x: index * STEP, y: 0, animated });
        },
      }),
      []
    );

    const contentStyle = useMemo(
      () => ({ paddingHorizontal: SIDE_PAD, paddingVertical: 8 }),
      []
    );

    return (
      <View>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={STEP}
          decelerationRate="fast"
          onScroll={scrollHandler}
          onMomentumScrollEnd={handleMomentumEnd}
          scrollEventThrottle={16}
          contentContainerStyle={contentStyle}>
          {group.participants.map((p, index) => (
            <DeckItem
              key={p.id}
              group={group}
              participant={p}
              index={index}
              scrollX={scrollX}
              onRetry={onRetry}
              onView={onView}
            />
          ))}
        </Animated.ScrollView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  // Height is intentionally omitted — the outer ScrollView sizes to the
  // tallest card's rendered height, so cards can grow/shrink with their
  // content (e.g. long display names, state-overlay chrome) without us
  // having to maintain a magic constant.
  item: {
    // Rotation pivots around the bottom edge so the concave "fan" tilt
    // looks like the cards are resting on an invisible surface — matches
    // apple-invites/src/apps/(a-c)/apple-invites/components/marquee-item.tsx
    transformOrigin: 'bottom',
    width: CARD_W,
    paddingHorizontal: ITEM_MARGIN,
    paddingVertical: ITEM_MARGIN,
  },
});
