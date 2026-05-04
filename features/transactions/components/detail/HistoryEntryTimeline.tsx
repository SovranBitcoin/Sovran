import React, { useMemo, useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { MintQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

import type { HistoryEntry } from '@cashu/coco-core';

import { AnimatedCheckpointDot, type CheckpointDotType } from '@/shared/blocks/transfer';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { convertTime } from '@/shared/lib/time';
import {
  meltQuoteExpired,
  getMeltQuoteTimeUntilExpiry,
  mintHistoryEntryExpired,
  getMintHistoryEntryTimeUntilExpiry,
} from '@/shared/lib/utils';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

import {
  buildTimeline,
  getCardLabel,
  getStatusHeader,
  getStatusColorType,
  type TimelineItem,
  type TimelineStepType,
} from './buildTimeline';

interface HistoryEntryTimelineProps {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  /** For NUT-18 payment requests - indicates token was created (prepared step complete) */
  tokenCreated?: boolean;
  /** For NUT-18 payment requests - indicates Nostr DM was sent */
  nostrSent?: boolean;
}

const LINE_WIDTH = 3;
const LINE_HEIGHT = 50;
const LINE_ANIM_MS = 400;
const LINE_TIMING = { duration: LINE_ANIM_MS, easing: Easing.out(Easing.cubic) };

type TimelineLineType = 'complete' | 'future' | 'expired-gradient' | 'rolled-back-gradient';

interface AnimatedTimelineLineProps {
  lineType: TimelineLineType;
  delayMs?: number;
  greenColor: string;
  redColor: string;
  orangeColor: string;
  greyColor: string;
}

const AnimatedTimelineLine = React.memo(function AnimatedTimelineLine({
  lineType,
  delayMs = 0,
  greenColor,
  redColor,
  orangeColor,
  greyColor,
}: AnimatedTimelineLineProps) {
  const isComplete = lineType === 'complete';
  const fillHeight = useSharedValue(isComplete ? 1 : 0);

  useEffect(() => {
    const target = lineType === 'complete' ? 1 : 0;
    fillHeight.value =
      delayMs > 0
        ? withDelay(delayMs, withTiming(target, LINE_TIMING))
        : withTiming(target, LINE_TIMING);
  }, [lineType, delayMs, fillHeight]);

  const fillStyle = useAnimatedStyle(() => ({
    height: `${fillHeight.value * 100}%`,
  }));

  if (lineType === 'expired-gradient' || lineType === 'rolled-back-gradient') {
    const endColor = lineType === 'expired-gradient' ? redColor : orangeColor;
    return (
      <Svg width={LINE_WIDTH} height={LINE_HEIGHT} style={{ marginVertical: 4 }}>
        <Defs>
          <LinearGradient id={`gradient-${lineType}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={greenColor} />
            <Stop offset="100%" stopColor={endColor} />
          </LinearGradient>
        </Defs>
        <Rect
          x={0}
          y={0}
          width={LINE_WIDTH}
          height={LINE_HEIGHT}
          rx={LINE_WIDTH / 2}
          ry={LINE_WIDTH / 2}
          fill={`url(#gradient-${lineType})`}
        />
      </Svg>
    );
  }

  return (
    <View
      style={{
        width: LINE_WIDTH,
        height: LINE_HEIGHT,
        backgroundColor: greyColor,
        borderRadius: LINE_WIDTH / 2,
        marginVertical: 4,
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[
          {
            width: LINE_WIDTH,
            backgroundColor: greenColor,
            borderRadius: LINE_WIDTH / 2,
          },
          fillStyle,
        ]}
      />
    </View>
  );
});

function timelineStepTypeToCheckpointDotType(stepType: TimelineStepType): CheckpointDotType {
  return stepType === 'expired' ? 'failed' : stepType;
}

export function HistoryEntryTimeline({
  historyEntry,
  meltQuote,
  tokenCreated,
  nostrSent,
}: HistoryEntryTimelineProps) {
  const [foreground, muted, greenColor, redColor, orangeColor] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
    'warning',
  ] as const);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const greyColor = muted;
  const foreground66 = opacity(foreground, 0.66);
  const foreground50 = opacity(foreground, 0.5);

  const meltExpiry = meltQuote?.expiry;
  const mintState = historyEntry.type === 'mint' ? historyEntry.state : null;

  useEffect(() => {
    const shouldUpdate =
      (historyEntry.type === 'melt' && meltExpiry) ||
      (historyEntry.type === 'mint' && mintState === MintQuoteState.UNPAID);

    if (shouldUpdate) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [historyEntry.type, meltExpiry, mintState]);

  const timeline = useMemo(
    () => buildTimeline({ historyEntry, meltQuote, currentTime, tokenCreated, nostrSent }),
    [historyEntry, meltQuote, currentTime, tokenCreated, nostrSent]
  );

  const cardLabel = getCardLabel(historyEntry, timeline, tokenCreated, nostrSent);
  const statusHeader = getStatusHeader(timeline);
  const statusColorType = getStatusColorType(timeline);

  const getExpiryBadge = (): string | null => {
    if (historyEntry.type === 'melt' && meltQuote && !meltQuoteExpired(meltQuote, currentTime)) {
      const expiryInfo = getMeltQuoteTimeUntilExpiry(meltQuote, currentTime);
      if (expiryInfo) return expiryInfo;
    }

    if (
      historyEntry.type === 'mint' &&
      historyEntry.state === MintQuoteState.UNPAID &&
      !mintHistoryEntryExpired(historyEntry)
    ) {
      const expiryInfo = getMintHistoryEntryTimeUntilExpiry(historyEntry);
      if (expiryInfo) return expiryInfo;
    }

    return null;
  };

  const expiryBadge = getExpiryBadge();

  const getLineType = (currentItem: TimelineItem, nextItem: TimelineItem): TimelineLineType => {
    if (nextItem.stepType === 'expired') return 'expired-gradient';
    if (nextItem.stepType === 'already-spent') return 'rolled-back-gradient';
    if (nextItem.stepType === 'rolled-back') return 'rolled-back-gradient';
    if (
      currentItem.stepType === 'complete' ||
      currentItem.stepType === 'current' ||
      currentItem.stepType === 'success'
    ) {
      if (
        nextItem.stepType === 'complete' ||
        nextItem.stepType === 'current' ||
        nextItem.stepType === 'success'
      ) {
        return 'complete';
      }
    }
    return 'future';
  };

  const getStatusHeaderColor = () => {
    switch (statusColorType) {
      case 'success':
        return greenColor;
      case 'error':
        return redColor;
      case 'warning':
        return orangeColor;
      default:
        return foreground66;
    }
  };

  const getStateTextColor = (stepType: TimelineStepType, isFuture: boolean) => {
    if (isFuture) return foreground50;
    if (stepType === 'expired') return redColor;
    if (stepType === 'already-spent') return orangeColor;
    if (stepType === 'rolled-back') return orangeColor;
    return foreground;
  };

  return (
    <Log name="HistoryEntryTimeline">
      <GradientCard style={styles.card} contentStyle={styles.cardContent}>
        <Text size={11} bold style={[styles.cardLabel, { color: foreground50 }]}>
          {cardLabel}
        </Text>

        <HStack style={{ marginBottom: 16 }} align="center">
          <Text
            size={14}
            heavy
            style={{
              color: getStatusHeaderColor(),
            }}>
            {statusHeader}
          </Text>
          {expiryBadge && (
            <Text
              size={12}
              style={{
                color: getStatusHeaderColor(),
                marginLeft: 4,
              }}>
              •{'  '}
              {expiryBadge}
            </Text>
          )}
        </HStack>

        <View>
          {timeline.map((item, index) => {
            const isLast = index === timeline.length - 1;
            const nextItem = !isLast ? timeline[index + 1] : null;
            const lineType = nextItem ? getLineType(item, nextItem) : null;
            const isFutureState =
              item.stepType === 'next-pending' || item.stepType === 'future-small';

            const dotDelay = index * 300;
            const lineDelay = dotDelay + 150;

            const contentMarginTop = item.stepType === 'future-small' ? -7 : -3;

            return (
              <Animated.View key={item.state} entering={FadeInDown.delay(index * 60).duration(250)}>
                <HStack align="flex-start">
                  <VStack align="center" style={{ marginRight: 14 }}>
                    <AnimatedCheckpointDot
                      type={timelineStepTypeToCheckpointDotType(item.stepType)}
                      delayMs={dotDelay}
                      greenColor={greenColor}
                      redColor={redColor}
                      orangeColor={orangeColor}
                      greyColor={greyColor}
                    />
                    {lineType && (
                      <AnimatedTimelineLine
                        lineType={lineType}
                        delayMs={lineDelay}
                        greenColor={greenColor}
                        redColor={redColor}
                        orangeColor={orangeColor}
                        greyColor={greyColor}
                      />
                    )}
                  </VStack>

                  <VStack
                    style={{
                      flex: 1,
                      paddingBottom: isLast ? 0 : 16,
                      marginTop: contentMarginTop,
                    }}>
                    <Text
                      size={15}
                      bold
                      style={{
                        color: getStateTextColor(item.stepType, isFutureState),
                        marginBottom: 2,
                      }}>
                      {item.displayLabel}
                    </Text>
                    {item.timestamp && (
                      <Text size={13} style={{ color: foreground66 }}>
                        {convertTime(new Date(item.timestamp))}
                      </Text>
                    )}
                    {item.info && (
                      <Text size={12} style={{ color: foreground66, marginTop: 2 }}>
                        {item.info}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              </Animated.View>
            );
          })}
        </View>
      </GradientCard>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
  cardContent: {
    padding: 20,
  },
  cardLabel: {
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
