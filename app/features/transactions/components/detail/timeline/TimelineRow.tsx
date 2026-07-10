// ---------------------------------------------------------------------------
// TimelineRow — one timeline row: dot + connector rail + label block
// ---------------------------------------------------------------------------
//
// Rows are keyed by the engine's `step.rowKey` (semantic slot identity —
// terminal steps inherit the displaced slot's rowKey), so a timeline that
// changes shape (rollback, expiry, off-chain settle) morphs each slot in
// place: the dot animates to its new status with the full draw-in
// choreography and the label crossfades — instead of remounting the whole
// timeline. The inner label block is keyed by `step.id`: meaning changes
// (id swap, e.g. 'pending' → 'rolled-back') crossfade the text block, while
// info-only updates (confirmation counts) mutate in place.

import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';

import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { TimelineStep, TimelineStepType } from 'wallet';

import {
  LoadingIndicator,
  mapCheckpointStatusToIndicator,
  type CheckpointStatus,
  type ConfirmationProgress,
} from '@/shared/blocks/status';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatDate } from '@/shared/lib/date';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { paymentLog } from '@/shared/lib/logger';

import {
  CONTENT_MARGIN_TOP,
  DOT_SIZE,
  LINE_ANIM_MS,
  LINE_TIMING,
  RAIL_HEIGHT,
  RAIL_MARGIN_VERTICAL,
  STROKE_PX,
  rowDelays,
  rowTransitions,
  type TimelineLineType,
} from './timelineTheme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export function timelineStepTypeToCheckpointStatus(stepType: TimelineStepType): CheckpointStatus {
  return stepType === 'expired' ? 'failed' : stepType;
}

interface AnimatedTimelineLineProps {
  lineType: TimelineLineType;
  delayMs?: number;
  successColor: string;
  dangerColor: string;
  warningColor: string;
  mutedColor: string;
  /** Diagnostics: index of the row ABOVE this connector, and the entry it
   *  belongs to. Primitives so React.memo still bails out on no-op renders. */
  debugRow?: number;
  debugEntryId?: string;
}

const AnimatedTimelineLine = React.memo(function AnimatedTimelineLine({
  lineType,
  delayMs = 0,
  successColor,
  dangerColor,
  warningColor,
  mutedColor,
  debugRow,
  debugEntryId,
}: AnimatedTimelineLineProps) {
  // Expired/rolled-back gradients are terminal fills too: they animate down
  // the rail exactly like a success fill, just with a gradient into the
  // outcome colour. Only 'future' stays unfilled.
  const isFilled = lineType !== 'future';
  const fillHeight = useSharedValue(isFilled ? 1 : 0);
  const gradientId = React.useId().replace(/:/g, '');
  const isFirstRunRef = useRef(true);
  // Settle-to-static: once a fill animation has fully played, render the fill
  // as a plain Rect. A Fabric commit racing the UI-thread animatedProps can
  // leave the animated fill visually stale (observed live: a grey rail under
  // a settled row while fillTarget was 1) — a static full-height fill cannot.
  const [settledStatic, setSettledStatic] = React.useState(false);

  useEffect(() => {
    const target = lineType === 'future' ? 0 : 1;
    paymentLog.debug('tx.history_timeline.line_anim', {
      entryId: debugEntryId,
      rowAbove: debugRow,
      lineType,
      fillTarget: target,
      // On mount the shared value already starts at the target, so the first
      // withTiming is a visual no-op; only later lineType flips actually draw.
      firstRun: isFirstRunRef.current,
      delayMs,
      durationMs: LINE_ANIM_MS,
      gradient:
        lineType === 'expired-gradient'
          ? 'success->danger'
          : lineType === 'rolled-back-gradient'
            ? 'success->warning'
            : null,
    });
    const firstRun = isFirstRunRef.current;
    isFirstRunRef.current = false;
    fillHeight.value =
      delayMs > 0
        ? withDelay(delayMs, withTiming(target, LINE_TIMING))
        : withTiming(target, LINE_TIMING);
    if (target === 1) {
      // Mounted-filled starts at the target (visual no-op) — settle at once;
      // a live fill settles after its delay + animation.
      const settleAtMs = firstRun ? 0 : delayMs + LINE_ANIM_MS + 150;
      const timer = setTimeout(() => setSettledStatic(true), settleAtMs);
      return () => clearTimeout(timer);
    }
    setSettledStatic(false);
    return undefined;
  }, [lineType, delayMs, fillHeight, debugEntryId, debugRow]);

  const fillProps = useAnimatedProps(() => ({
    height: fillHeight.value * RAIL_HEIGHT,
  }));

  const isGradient = lineType === 'expired-gradient' || lineType === 'rolled-back-gradient';
  const endColor = lineType === 'expired-gradient' ? dangerColor : warningColor;

  return (
    <Svg
      testID="history-entry-timeline-line"
      width={STROKE_PX}
      height={RAIL_HEIGHT}
      style={styles.timelineLine}>
      {isGradient && (
        <Defs>
          {/* userSpaceOnUse pins the gradient to the full rail so the colour
              ramp stays put while the fill's bounding box grows. */}
          <LinearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={RAIL_HEIGHT}>
            <Stop offset="0%" stopColor={successColor} />
            <Stop offset="100%" stopColor={endColor} />
          </LinearGradient>
        </Defs>
      )}
      <Rect
        x={0}
        y={0}
        width={STROKE_PX}
        height={RAIL_HEIGHT}
        rx={STROKE_PX / 2}
        ry={STROKE_PX / 2}
        fill={mutedColor}
      />
      {settledStatic && isFilled ? (
        <Rect
          x={0}
          y={0}
          width={STROKE_PX}
          height={RAIL_HEIGHT}
          rx={STROKE_PX / 2}
          ry={STROKE_PX / 2}
          fill={isGradient ? `url(#${gradientId})` : successColor}
        />
      ) : (
        <AnimatedRect
          x={0}
          y={0}
          width={STROKE_PX}
          rx={STROKE_PX / 2}
          ry={STROKE_PX / 2}
          fill={isGradient ? `url(#${gradientId})` : successColor}
          animatedProps={fillProps}
        />
      )}
    </Svg>
  );
});

interface TimelineRowProps {
  step: TimelineStep;
  index: number;
  isLast: boolean;
  /** Connector rail style to the row below, or null on the last row. */
  connector: TimelineLineType | null;
  /** False during the very first render so opening the screen paints the
   *  timeline without entrance fades. */
  hasMounted: boolean;
  /** Present only on the row that owns the segmented confirmation ring. */
  confirmationProgress?: ConfirmationProgress;
  segmentedInProgress?: boolean;
  /** Diagnostics context for the tx.history_timeline.* taxonomy. */
  entryId: string;
}

export function TimelineRow({
  step,
  index,
  isLast,
  connector,
  hasMounted,
  confirmationProgress,
  segmentedInProgress,
  entryId,
}: TimelineRowProps) {
  const [foreground, mutedColor, successColor, dangerColor, warningColor] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
    'warning',
  ] as const);
  const foreground66 = opacity(foreground, 0.66);
  const foreground50 = opacity(foreground, 0.5);

  const isFutureState = step.stepType === 'next-pending' || step.stepType === 'future-small';
  const isWaitingStep = step.stepType === 'waiting';
  const { dotDelayMs, lineDelayMs } = rowDelays(index);
  const { entering, exiting } = rowTransitions(hasMounted);

  const getStateTextColor = (stepType: TimelineStepType, isFuture: boolean) => {
    if (isFuture) return foreground50;
    if (stepType === 'expired') return dangerColor;
    if (stepType === 'waiting') return warningColor;
    if (stepType === 'already-spent') return warningColor;
    if (stepType === 'rolled-back') return warningColor;
    return foreground;
  };

  return (
    <Animated.View entering={entering} exiting={exiting}>
      <HStack align="flex-start">
        <VStack align="center" style={{ marginRight: 14 }}>
          <LoadingIndicator
            size={DOT_SIZE}
            // Ring dashes and confirmation segments render at the connector
            // rail's width so the dot strokes and the rail read as one weight.
            strokeWidthPx={STROKE_PX}
            transitionDelayMs={dotDelayMs}
            color={isWaitingStep ? warningColor : undefined}
            // Unfilled strokes (idle dashes, pending segments) render in the
            // rail's unfilled track color so ring and connector read as one
            // piece of chrome. Waiting steps keep their warning tint instead.
            pendingColor={isWaitingStep ? undefined : mutedColor}
            successColor={successColor}
            errorColor={dangerColor}
            revertedColor={warningColor}
            warningColor={warningColor}
            confirmationProgress={confirmationProgress}
            // Before a payment is observed the ring only previews the required
            // confirmations — nothing is in progress yet, so the next segment
            // must not breathe.
            segmentedInProgress={segmentedInProgress}
            // Verbose dot diagnostics: every phase/result transition, segment
            // fill, and breathe pulse this dot schedules lands in the payment
            // log tagged with its row + step.
            onDebugEvent={(event, params) =>
              paymentLog.debug(`tx.history_timeline.${event}`, {
                entryId,
                row: index,
                state: step.state,
                stepType: step.stepType,
                label: step.displayLabel,
                ...params,
              })
            }
            {...mapCheckpointStatusToIndicator(timelineStepTypeToCheckpointStatus(step.stepType))}
          />
          {connector && (
            <AnimatedTimelineLine
              lineType={connector}
              delayMs={lineDelayMs}
              successColor={successColor}
              dangerColor={dangerColor}
              warningColor={warningColor}
              mutedColor={mutedColor}
              debugRow={index}
              debugEntryId={entryId}
            />
          )}
        </VStack>

        <VStack
          style={{
            flex: 1,
            paddingBottom: isLast ? 0 : 16,
            marginTop: CONTENT_MARGIN_TOP,
          }}>
          {/* Keyed by the step's semantic id so a slot that changes meaning in
              place ("Sent" → "Cancelled") crossfades its text block, while
              info-only updates (confirmation counts) mutate without
              remounting. */}
          <Animated.View key={step.id} entering={entering} exiting={exiting}>
            <Text
              size={15}
              bold
              style={{
                color: getStateTextColor(step.stepType, isFutureState),
                marginBottom: 2,
              }}>
              {step.displayLabel}
            </Text>
            {step.timestamp && (
              <Text size={13} style={{ color: foreground66 }}>
                {formatDate(step.timestamp, 'iso')}
              </Text>
            )}
            {step.info && (
              <Text size={12} style={{ color: foreground66, marginTop: 2 }}>
                {step.info}
              </Text>
            )}
          </Animated.View>
        </VStack>
      </HStack>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  timelineLine: {
    marginVertical: RAIL_MARGIN_VERTICAL,
  },
});
