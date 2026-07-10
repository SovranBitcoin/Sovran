// ---------------------------------------------------------------------------
// Timeline theme — THE one metric/timing table for the timeline renderer
// ---------------------------------------------------------------------------
//
// Every px metric and animation timing the timeline draws with lives here so
// the dot chrome, connector rail, and label block cannot drift apart. The
// values are pinned by __tests__/historyEntryTimelineLine.test.tsx (3px rails,
// marginVertical 4, -3 label margins) and the timelineScenarioProps snapshots.

import { Easing, FadeIn, FadeOut } from 'react-native-reanimated';

import { isSettledStepType, type TimelineStep } from 'wallet';

/** Stroke thickness shared by the connector rail AND the LoadingIndicator's
 *  `strokeWidthPx` so dot rings/segments and the rail read as one weight. */
export const STROKE_PX = 3;
export const RAIL_HEIGHT = 50;
export const RAIL_MARGIN_VERTICAL = 4;
export const DOT_SIZE = 20;
// Top-aligns every label's cap height with the top of its 20px dot. One
// constant for ALL step types: the old future-small special case (-7) made a
// step's label jump 4px the moment it went active and gained its sublabel.
export const CONTENT_MARGIN_TOP = -3;
/** Cascade: each row's dot transition waits one stagger per row index… */
export const DOT_STAGGER_MS = 300;
/** …and its connector rail starts half a stagger after its dot. */
export const LINE_OFFSET_MS = 150;
/** Row / label-block entrance+exit crossfade duration. */
export const FADE_MS = 220;
/** First-paint entrance: every row fades in over this duration… */
export const ENTRANCE_FADE_MS = 350;
/** …offset by one stagger per row index. A uniform entrance regardless of
 *  data readiness: labels that resolve within the window (e.g. the onchain
 *  network row correcting "Broadcasting…" → "Settled off-chain" after the
 *  first quote read) change while the row is still translucent instead of
 *  hard-swapping at full opacity. */
export const ENTRANCE_STAGGER_MS = 120;
export const LINE_ANIM_MS = 400;
export const LINE_TIMING = {
  duration: LINE_ANIM_MS,
  easing: Easing.out(Easing.cubic),
};

export type TimelineLineType = 'complete' | 'future' | 'expired-gradient' | 'rolled-back-gradient';

/** Connector rail style between a row and the row below it. Expired /
 *  rolled-back / already-spent rows pull a gradient fill into the outcome
 *  colour; two settled-ish rows share a solid success fill; anything else
 *  leaves the rail unfilled. The "settled-ish" set is wallet's
 *  isSettledStepType — the one classification owner. */
export function connectorType(
  prev: Pick<TimelineStep, 'stepType'>,
  next: Pick<TimelineStep, 'stepType'>
): TimelineLineType {
  if (next.stepType === 'expired') return 'expired-gradient';
  if (next.stepType === 'already-spent') return 'rolled-back-gradient';
  if (next.stepType === 'rolled-back') return 'rolled-back-gradient';
  if (isSettledStepType(prev.stepType) && isSettledStepType(next.stepType)) {
    return 'complete';
  }
  return 'future';
}

/** Left→right cascade delays for a row: the dot completes, then its rail
 *  fills, then the next dot activates. */
export function rowDelays(index: number): { dotDelayMs: number; lineDelayMs: number } {
  const dotDelayMs = index * DOT_STAGGER_MS;
  return { dotDelayMs, lineDelayMs: dotDelayMs + LINE_OFFSET_MS };
}

/** Symmetric row / label-block transitions. The first paint gets a uniform
 *  staggered entrance (every row fades in whether or not its data has
 *  settled — late-resolving labels correct themselves under the fade); rows
 *  and label blocks added by LATER timeline changes crossfade at FADE_MS;
 *  exits always fade. */
export function rowTransitions(
  hasMounted: boolean,
  index: number
): {
  entering: ReturnType<typeof FadeIn.duration>;
  exiting: ReturnType<typeof FadeOut.duration>;
} {
  return {
    entering: hasMounted
      ? FadeIn.duration(FADE_MS)
      : FadeIn.duration(ENTRANCE_FADE_MS).delay(index * ENTRANCE_STAGGER_MS),
    exiting: FadeOut.duration(FADE_MS),
  };
}
