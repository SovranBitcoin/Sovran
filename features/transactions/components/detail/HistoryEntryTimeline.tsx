import React, { useMemo, useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { MintQuoteState, MeltQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
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

import type {
  HistoryEntry,
  MintHistoryEntry,
  MeltHistoryEntry,
  SendHistoryEntry,
  ReceiveHistoryEntry,
} from 'coco-cashu-core';

import { AnimatedCheckpointDot, type CheckpointDotType } from '@/shared/blocks/transfer';
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

interface HistoryEntryTimelineProps {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  /** For NUT-18 payment requests - indicates token was created (prepared step complete) */
  tokenCreated?: boolean;
  /** For NUT-18 payment requests - indicates Nostr DM was sent */
  nostrSent?: boolean;
}

// Define the state progressions for each transaction type
const MINT_STATES = [MintQuoteState.UNPAID, MintQuoteState.PAID, MintQuoteState.ISSUED] as const;
const MELT_STATES = [MeltQuoteState.UNPAID, MeltQuoteState.PENDING, MeltQuoteState.PAID] as const;

// Send states from coco: 'prepared' | 'pending' | 'finalized' | 'rolledBack'
const SEND_STATES = ['prepared', 'pending', 'finalized'] as const;
// Payment request states include Nostr Send step
const PAYMENT_REQUEST_STATES = ['prepared', 'nostrSent', 'pending', 'finalized'] as const;
const SEND_STATE_LABELS: Record<string, string> = {
  prepared: 'Created',
  nostrSent: 'Delivered',
  pending: 'Pending',
  finalized: 'Claimed',
  rolledBack: 'Cancelled',
};

// Receive states: pending (in memory, not yet redeemed) → redeemed (claimed to wallet)
const RECEIVE_STATES = ['pending', 'redeemed'] as const;
const RECEIVE_STATE_LABELS: Record<string, string> = {
  pending: 'Pending',
  redeemed: 'Added to wallet',
  alreadySpent: 'Already spent',
};

// Mint/Melt state display labels
const MINT_STATE_LABELS: Record<string, string> = {
  [MintQuoteState.UNPAID]: 'Waiting for payment',
  [MintQuoteState.PAID]: 'Payment received',
  [MintQuoteState.ISSUED]: 'Complete',
};

const MELT_STATE_LABELS: Record<string, string> = {
  [MeltQuoteState.UNPAID]: 'Ready to send',
  [MeltQuoteState.PENDING]: 'Sending',
  [MeltQuoteState.PAID]: 'Sent',
};

const EXPIRED_STATE = 'expired';

// Timeline step types
type TimelineStepType =
  | 'complete'
  | 'current'
  | 'next-pending'
  | 'future-small'
  | 'expired'
  | 'rolled-back'
  | 'already-spent'
  | 'success';

interface TimelineItem {
  state: string;
  displayLabel: string;
  stepType: TimelineStepType;
  timestamp?: number;
  info?: string;
}

function buildTimeline({
  historyEntry,
  meltQuote,
  currentTime,
  tokenCreated,
  nostrSent,
}: {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  currentTime: number;
  tokenCreated?: boolean;
  nostrSent?: boolean;
}): TimelineItem[] {
  switch (historyEntry.type) {
    case 'mint': {
      const mintTx = historyEntry as MintHistoryEntry;
      const isExpired = mintTx.state === MintQuoteState.UNPAID && mintHistoryEntryExpired(mintTx);

      if (isExpired) {
        return [
          {
            state: MintQuoteState.UNPAID,
            displayLabel: MINT_STATE_LABELS[MintQuoteState.UNPAID],
            stepType: 'complete',
            timestamp: mintTx.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: 'Expired',
            stepType: 'expired',
            info: 'Invoice expired without payment',
          },
        ];
      }

      const currentIndex = MINT_STATES.indexOf(mintTx.state);
      return MINT_STATES.map((state, index) => {
        let stepType: TimelineStepType;
        if (index < currentIndex) {
          stepType = 'complete';
        } else if (index === currentIndex) {
          stepType = index === MINT_STATES.length - 1 ? 'success' : 'current';
        } else if (index === currentIndex + 1) {
          stepType = 'next-pending';
        } else {
          stepType = 'future-small';
        }

        let info: string | undefined;
        if (stepType === 'current' && state === MintQuoteState.UNPAID) {
          info = 'Pay the invoice to receive funds';
        } else if (stepType === 'next-pending' && state === MintQuoteState.ISSUED) {
          info = 'Adding to wallet...';
        } else if (stepType === 'success' && state === MintQuoteState.ISSUED) {
          info = `+${mintTx.amount} sats added to wallet`;
        }

        return {
          state,
          displayLabel: MINT_STATE_LABELS[state],
          stepType,
          timestamp: index <= currentIndex ? mintTx.createdAt : undefined,
          info,
        };
      });
    }

    case 'melt': {
      const meltTx = historyEntry as MeltHistoryEntry;
      const isExpired =
        meltQuote &&
        meltTx.state === MeltQuoteState.UNPAID &&
        meltQuoteExpired(meltQuote, currentTime);

      if (isExpired) {
        return [
          {
            state: MeltQuoteState.UNPAID,
            displayLabel: 'Unpaid',
            stepType: 'complete',
            timestamp: meltTx.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: 'Expired',
            stepType: 'expired',
            info: 'Quote expired',
          },
        ];
      }

      const currentIndex = MELT_STATES.indexOf(meltTx.state);
      return MELT_STATES.map((state, index) => {
        let stepType: TimelineStepType;
        if (index < currentIndex) {
          stepType = 'complete';
        } else if (index === currentIndex) {
          stepType = index === MELT_STATES.length - 1 ? 'success' : 'current';
        } else if (index === currentIndex + 1) {
          stepType = 'next-pending';
        } else {
          stepType = 'future-small';
        }

        let info: string | undefined;
        if (stepType === 'current' && state === MeltQuoteState.UNPAID) {
          info = 'Tap Send to complete payment';
        } else if (stepType === 'current' && state === MeltQuoteState.PENDING) {
          info = 'Payment in progress...';
        } else if (stepType === 'success' && state === MeltQuoteState.PAID) {
          info = 'Payment complete';
        }

        return {
          state,
          displayLabel: MELT_STATE_LABELS[state],
          stepType,
          timestamp: index <= currentIndex ? meltTx.createdAt : undefined,
          info,
        };
      });
    }

    case 'send': {
      const sendTx = historyEntry as SendHistoryEntry;
      const txState = sendTx.state;

      // Handle rolled back as a special terminal state
      if (txState === 'rolledBack') {
        const rolledBackTimeline: TimelineItem[] = [
          {
            state: 'prepared',
            displayLabel: SEND_STATE_LABELS.prepared,
            stepType: 'complete',
            timestamp: sendTx.createdAt,
          },
        ];
        // Include Nostr Send step if this was a payment request
        if (nostrSent) {
          rolledBackTimeline.push({
            state: 'nostrSent',
            displayLabel: SEND_STATE_LABELS.nostrSent,
            stepType: 'complete',
            timestamp: sendTx.createdAt,
          });
        }
        rolledBackTimeline.push({
          state: 'rolledBack',
          displayLabel: SEND_STATE_LABELS.rolledBack,
          stepType: 'rolled-back',
          info: 'Token funds returned to your balance',
        });
        return rolledBackTimeline;
      }

      // Determine if this is payment request mode (tokenCreated or nostrSent props indicate PR mode)
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;
      const states = isPaymentRequestMode ? PAYMENT_REQUEST_STATES : SEND_STATES;

      // Map coco state to timeline index
      // For payment request: prepared=0, nostrSent=1, pending=2, finalized=3
      // For normal: prepared=0, pending=1, finalized=2
      let currentIndex: number;
      if (isPaymentRequestMode) {
        // Derive timeline position from core send state.
        // PAYMENT_REQUEST_STATES: ['prepared', 'nostrSent', 'pending', 'finalized']
        if (txState === 'prepared') {
          currentIndex = 0; // "Created" is current
        } else if (txState === 'pending') {
          currentIndex = 2; // "Pending" — token created + delivered
        } else if (txState === 'finalized') {
          currentIndex = 3; // "Claimed" — recipient claimed
        } else {
          currentIndex = 0;
        }
      } else {
        currentIndex = SEND_STATES.indexOf(txState as (typeof SEND_STATES)[number]);
      }

      return states.map((state, index) => {
        let stepType: TimelineStepType;
        if (index < currentIndex) {
          stepType = 'complete';
        } else if (index === currentIndex) {
          stepType = index === states.length - 1 ? 'success' : 'current';
        } else if (index === currentIndex + 1) {
          stepType = 'next-pending';
        } else {
          stepType = 'future-small';
        }

        let info: string | undefined;
        if (stepType === 'current' && state === 'prepared') {
          info = 'Ready to share';
        } else if (stepType === 'complete' && state === 'nostrSent') {
          info = 'Sent via Nostr';
        } else if (stepType === 'current' && state === 'nostrSent') {
          info = 'Sending...';
        } else if (stepType === 'current' && state === 'pending') {
          info = 'Waiting for recipient';
        } else if (stepType === 'success' && state === 'finalized') {
          info = 'Claimed by recipient';
        }

        return {
          state,
          displayLabel: SEND_STATE_LABELS[state],
          stepType,
          timestamp: index <= currentIndex ? sendTx.createdAt : undefined,
          info,
        };
      });
    }

    case 'receive': {
      const receiveTx = historyEntry as ReceiveHistoryEntry & { state?: string };
      const txState = receiveTx.state || 'redeemed';

      // Local-only terminal state for scans that were already redeemed elsewhere.
      if (txState === 'alreadySpent') {
        return [
          {
            state: 'pending',
            displayLabel: RECEIVE_STATE_LABELS.pending,
            stepType: 'complete',
            timestamp: receiveTx.createdAt,
          },
          {
            state: 'alreadySpent',
            displayLabel: RECEIVE_STATE_LABELS.alreadySpent,
            stepType: 'already-spent',
            info: 'Token was already redeemed elsewhere',
          },
        ];
      }

      const currentIndex = RECEIVE_STATES.indexOf(txState as (typeof RECEIVE_STATES)[number]);
      const effectiveIndex = currentIndex === -1 ? RECEIVE_STATES.length - 1 : currentIndex;

      return RECEIVE_STATES.map((state, index) => {
        let stepType: TimelineStepType;
        if (index < effectiveIndex) {
          stepType = 'complete';
        } else if (index === effectiveIndex) {
          stepType = index === RECEIVE_STATES.length - 1 ? 'success' : 'current';
        } else {
          stepType = 'next-pending';
        }

        let info: string | undefined;
        if (stepType === 'current' && state === 'pending') {
          info = 'Tap Redeem to add to wallet';
        } else if (stepType === 'success' && state === 'redeemed') {
          info = `+${receiveTx.amount} sats added to wallet`;
        }

        return {
          state,
          displayLabel: RECEIVE_STATE_LABELS[state],
          stepType,
          timestamp: index <= effectiveIndex ? receiveTx.createdAt : undefined,
          info,
        };
      });
    }

    default:
      return [];
  }
}

// ============ Timeline Components ============

function timelineStepTypeToCheckpointDotType(stepType: TimelineStepType): CheckpointDotType {
  return stepType === 'expired' ? 'failed' : stepType;
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

  // Gradient lines for terminal states
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

  // Animated solid line: grey background with green fill overlay
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

// Get card label (e.g., "MINT • AWAITING PAYMENT")
const getCardLabel = (
  historyEntry: HistoryEntry,
  timeline: TimelineItem[],
  tokenCreated?: boolean,
  nostrSent?: boolean
): string => {
  const isFailed = timeline.some(
    (item) =>
      item.stepType === 'expired' ||
      item.stepType === 'rolled-back' ||
      item.stepType === 'already-spent'
  );

  let status = '';

  switch (historyEntry.type) {
    case 'mint': {
      const mintTx = historyEntry as MintHistoryEntry;
      if (isFailed || timeline.some((item) => item.stepType === 'expired')) {
        status = 'Failed';
      } else if (mintTx.state === MintQuoteState.ISSUED) {
        status = 'Complete';
      } else if (mintTx.state === MintQuoteState.PAID) {
        status = 'In Progress';
      } else {
        status = 'Awaiting Payment';
      }
      return `Receive • ${status}`;
    }
    case 'melt': {
      const meltTx = historyEntry as MeltHistoryEntry;
      if (isFailed || timeline.some((item) => item.stepType === 'expired')) {
        status = 'Failed';
      } else if (meltTx.state === MeltQuoteState.PAID) {
        status = 'Complete';
      } else if (meltTx.state === MeltQuoteState.PENDING) {
        status = 'In Progress';
      } else {
        status = 'Ready';
      }
      return `Send • ${status}`;
    }
    case 'send': {
      const sendTx = historyEntry as SendHistoryEntry;
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;
      const label = isPaymentRequestMode ? 'Payment' : 'Send';
      if (sendTx.state === 'rolledBack') {
        status = 'Cancelled';
      } else if (sendTx.state === 'finalized') {
        status = 'Complete';
      } else if (sendTx.state === 'pending') {
        status = 'In Progress';
      } else {
        status = 'Ready';
      }
      return `${label} • ${status}`;
    }
    case 'receive': {
      const receiveTx = historyEntry as ReceiveHistoryEntry & { state?: string };
      const txState = receiveTx.state || 'redeemed';
      if (txState === 'redeemed') {
        status = 'Complete';
      } else if (txState === 'alreadySpent') {
        status = 'Already Spent';
      } else {
        status = 'Pending';
      }
      return `Receive • ${status}`;
    }
    default:
      return 'Transaction';
  }
};

// Get status header (uppercase current state)
const getStatusHeader = (timeline: TimelineItem[]): string => {
  const current = timeline.find(
    (item) =>
      item.stepType === 'current' ||
      item.stepType === 'success' ||
      item.stepType === 'expired' ||
      item.stepType === 'rolled-back' ||
      item.stepType === 'already-spent'
  );
  if (current) {
    return current.displayLabel.toUpperCase();
  }
  return timeline[timeline.length - 1]?.displayLabel.toUpperCase() || '';
};

// Get status header color class
type StatusColorType = 'default' | 'success' | 'error' | 'warning';

const getStatusColorType = (timeline: TimelineItem[]): StatusColorType => {
  const hasExpired = timeline.some((item) => item.stepType === 'expired');
  const hasRolledBack = timeline.some((item) => item.stepType === 'rolled-back');
  const hasAlreadySpent = timeline.some((item) => item.stepType === 'already-spent');
  const hasSuccess = timeline.some((item) => item.stepType === 'success');

  if (hasExpired) return 'error';
  if (hasAlreadySpent) return 'warning';
  if (hasRolledBack) return 'warning';
  if (hasSuccess) return 'success';
  return 'default';
};

// ============ Main Component ============

export function HistoryEntryTimeline({
  historyEntry,
  meltQuote,
  tokenCreated,
  nostrSent,
}: HistoryEntryTimelineProps) {
  const [foreground, muted, greenColor, redColor] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
  ] as const);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const orangeColor = '#fb923c';
  const greyColor = muted;
  const foreground66 = opacity(foreground, 0.66);
  const foreground50 = opacity(foreground, 0.5);

  // Update time every second for real-time countdown
  useEffect(() => {
    const shouldUpdate =
      (historyEntry.type === 'melt' && meltQuote?.expiry) ||
      (historyEntry.type === 'mint' &&
        (historyEntry as MintHistoryEntry).state === MintQuoteState.UNPAID);

    if (shouldUpdate) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [meltQuote, historyEntry]);

  const timeline = useMemo(() => {
    return buildTimeline({ historyEntry, meltQuote, currentTime, tokenCreated, nostrSent });
  }, [historyEntry, meltQuote, currentTime, tokenCreated, nostrSent]);

  const cardLabel = getCardLabel(historyEntry, timeline, tokenCreated, nostrSent);
  const statusHeader = getStatusHeader(timeline);
  const statusColorType = getStatusColorType(timeline);

  // Get expiry info
  const getExpiryBadge = (): string | null => {
    if (historyEntry.type === 'melt' && meltQuote && !meltQuoteExpired(meltQuote, currentTime)) {
      const expiryInfo = getMeltQuoteTimeUntilExpiry(meltQuote, currentTime);
      if (expiryInfo) return expiryInfo;
    }

    if (historyEntry.type === 'mint') {
      const mintTx = historyEntry as MintHistoryEntry;
      if (mintTx.state === MintQuoteState.UNPAID && !mintHistoryEntryExpired(mintTx)) {
        const expiryInfo = getMintHistoryEntryTimeUntilExpiry(mintTx);
        if (expiryInfo) return expiryInfo;
      }
    }

    return null;
  };

  const expiryBadge = getExpiryBadge();

  // Determine line type between items
  const getLineType = (
    currentItem: TimelineItem,
    nextItem: TimelineItem
  ): 'complete' | 'future' | 'expired-gradient' | 'rolled-back-gradient' => {
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

  // Status header color
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

  // Get text color for state label
  const getStateTextColor = (stepType: TimelineStepType, isFuture: boolean) => {
    if (isFuture) return foreground50;
    if (stepType === 'expired') return redColor;
    if (stepType === 'already-spent') return orangeColor;
    if (stepType === 'rolled-back') return orangeColor;
    return foreground;
  };

  return (
    <View className="bg-surface-secondary mx-4 rounded-2xl p-5">
      {/* Card Label */}
      <Text size={11} bold style={[styles.cardLabel, { color: foreground50 }]}>
        {cardLabel}
      </Text>

      {/* Status Header */}
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

      {/* Timeline */}
      <View>
        {timeline.map((item, index) => {
          const isLast = index === timeline.length - 1;
          const nextItem = !isLast ? timeline[index + 1] : null;
          const lineType = nextItem ? getLineType(item, nextItem) : null;
          const isFutureState =
            item.stepType === 'next-pending' || item.stepType === 'future-small';

          // Stagger: dot animates, then line fills, then next dot
          const dotDelay = index * 300;
          const lineDelay = dotDelay + 150;

          const contentMarginTop = item.stepType === 'future-small' ? -7 : -3;

          return (
            <Animated.View key={item.state} entering={FadeInDown.delay(index * 60).duration(250)}>
              <HStack align="flex-start">
                {/* Timeline Indicator Column */}
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

                {/* Content Column */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  cardLabel: {
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
