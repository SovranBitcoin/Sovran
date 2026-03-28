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
import {
  MINT_COPY,
  MELT_COPY,
  SEND_COPY,
  PAYMENT_REQUEST_COPY,
  RECEIVE_COPY,
} from '@/shared/lib/paymentCopy';
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
// Payment request states: Created → Delivered → Claimed (no separate "Pending" step)
const PAYMENT_REQUEST_STATES = ['prepared', 'nostrSent', 'finalized'] as const;
// Receive states: pending (in memory, not yet redeemed) → redeemed (claimed to wallet)
const RECEIVE_STATES = ['pending', 'redeemed'] as const;

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
            displayLabel: MINT_COPY.UNPAID.label,
            stepType: 'complete',
            timestamp: mintTx.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: MINT_COPY.expired.label,
            stepType: 'expired',
            info: MINT_COPY.expired.info,
          },
        ];
      }

      // UNPAID/PAID are waiting states — use next-pending (grey spinner), not current (green)
      switch (mintTx.state) {
        case MintQuoteState.UNPAID:
          return [
            { state: MintQuoteState.UNPAID, displayLabel: MINT_COPY.UNPAID.label, stepType: 'next-pending' as TimelineStepType, info: MINT_COPY.UNPAID.info },
            { state: MintQuoteState.PAID, displayLabel: MINT_COPY.PAID.label, stepType: 'future-small' as TimelineStepType },
            { state: MintQuoteState.ISSUED, displayLabel: MINT_COPY.ISSUED.label, stepType: 'future-small' as TimelineStepType },
          ];
        case MintQuoteState.PAID:
          return [
            { state: MintQuoteState.UNPAID, displayLabel: MINT_COPY.UNPAID.label, stepType: 'complete' as TimelineStepType, timestamp: mintTx.createdAt },
            { state: MintQuoteState.PAID, displayLabel: MINT_COPY.PAID.label, stepType: 'next-pending' as TimelineStepType, info: MINT_COPY.PAID.info },
            { state: MintQuoteState.ISSUED, displayLabel: MINT_COPY.ISSUED.label, stepType: 'future-small' as TimelineStepType },
          ];
        case MintQuoteState.ISSUED:
          return [
            { state: MintQuoteState.UNPAID, displayLabel: MINT_COPY.UNPAID.label, stepType: 'complete' as TimelineStepType, timestamp: mintTx.createdAt },
            { state: MintQuoteState.PAID, displayLabel: MINT_COPY.PAID.label, stepType: 'complete' as TimelineStepType, timestamp: mintTx.createdAt },
            { state: MintQuoteState.ISSUED, displayLabel: MINT_COPY.ISSUED.label, stepType: 'success' as TimelineStepType, info: MINT_COPY.ISSUED.info(mintTx.amount) },
          ];
        default:
          return [];
      }
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
            displayLabel: MELT_COPY.UNPAID.label,
            stepType: 'complete',
            timestamp: meltTx.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: MELT_COPY.expired.label,
            stepType: 'expired',
            info: MELT_COPY.expired.info,
          },
        ];
      }

      // UNPAID is a waiting state; PENDING is active processing (lightning payment routing)
      switch (meltTx.state) {
        case MeltQuoteState.UNPAID:
          return [
            { state: MeltQuoteState.UNPAID, displayLabel: MELT_COPY.UNPAID.label, stepType: 'next-pending' as TimelineStepType, info: MELT_COPY.UNPAID.info },
            { state: MeltQuoteState.PENDING, displayLabel: MELT_COPY.PENDING.label, stepType: 'future-small' as TimelineStepType },
            { state: MeltQuoteState.PAID, displayLabel: MELT_COPY.PAID.label, stepType: 'future-small' as TimelineStepType },
          ];
        case MeltQuoteState.PENDING:
          return [
            { state: MeltQuoteState.UNPAID, displayLabel: MELT_COPY.UNPAID.label, stepType: 'complete' as TimelineStepType, timestamp: meltTx.createdAt },
            { state: MeltQuoteState.PENDING, displayLabel: MELT_COPY.PENDING.label, stepType: 'current' as TimelineStepType, info: MELT_COPY.PENDING.info },
            { state: MeltQuoteState.PAID, displayLabel: MELT_COPY.PAID.label, stepType: 'future-small' as TimelineStepType },
          ];
        case MeltQuoteState.PAID:
          return [
            { state: MeltQuoteState.UNPAID, displayLabel: MELT_COPY.UNPAID.label, stepType: 'complete' as TimelineStepType, timestamp: meltTx.createdAt },
            { state: MeltQuoteState.PENDING, displayLabel: MELT_COPY.PENDING.label, stepType: 'complete' as TimelineStepType, timestamp: meltTx.createdAt },
            { state: MeltQuoteState.PAID, displayLabel: MELT_COPY.PAID.label, stepType: 'success' as TimelineStepType, info: MELT_COPY.PAID.info },
          ];
        default:
          return [];
      }
    }

    case 'send': {
      const sendTx = historyEntry as SendHistoryEntry;
      const txState = sendTx.state;

      // Handle rolled back as a special terminal state
      if (txState === 'rolledBack') {
        const rolledBackTimeline: TimelineItem[] = [
          {
            state: 'prepared',
            displayLabel: SEND_COPY.prepared.label,
            stepType: 'complete',
            timestamp: sendTx.createdAt,
          },
        ];
        // Include Nostr Send step if this was a payment request
        if (nostrSent) {
          rolledBackTimeline.push({
            state: 'nostrSent',
            displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
            stepType: 'complete',
            timestamp: sendTx.createdAt,
          });
        }
        rolledBackTimeline.push({
          state: 'rolledBack',
          displayLabel: SEND_COPY.rolledBack.label,
          stepType: 'rolled-back',
          info: SEND_COPY.rolledBack.info,
        });
        return rolledBackTimeline;
      }

      // Determine if this is payment request mode (tokenCreated or nostrSent props indicate PR mode)
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;

      if (isPaymentRequestMode) {
        // Payment request: Created → Delivered → Claimed
        switch (txState) {
          case 'prepared':
            return [
              { state: 'prepared', displayLabel: PAYMENT_REQUEST_COPY.prepared.label, stepType: 'current' as TimelineStepType, info: PAYMENT_REQUEST_COPY.prepared.info },
              { state: 'nostrSent', displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label, stepType: 'next-pending' as TimelineStepType },
              { state: 'finalized', displayLabel: PAYMENT_REQUEST_COPY.finalized.label, stepType: 'future-small' as TimelineStepType },
            ];
          case 'pending':
            if (nostrSent) {
              return [
                { state: 'prepared', displayLabel: PAYMENT_REQUEST_COPY.prepared.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt },
                { state: 'nostrSent', displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt, info: PAYMENT_REQUEST_COPY.nostrSent.infoSent },
                { state: 'finalized', displayLabel: PAYMENT_REQUEST_COPY.finalized.label, stepType: 'next-pending' as TimelineStepType, info: SEND_COPY.pending.info },
              ];
            }
            return [
              { state: 'prepared', displayLabel: PAYMENT_REQUEST_COPY.prepared.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt },
              { state: 'nostrSent', displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label, stepType: 'current' as TimelineStepType, info: PAYMENT_REQUEST_COPY.nostrSent.infoSending },
              { state: 'finalized', displayLabel: PAYMENT_REQUEST_COPY.finalized.label, stepType: 'future-small' as TimelineStepType },
            ];
          case 'finalized':
            return [
              { state: 'prepared', displayLabel: PAYMENT_REQUEST_COPY.prepared.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt },
              { state: 'nostrSent', displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt, info: PAYMENT_REQUEST_COPY.nostrSent.infoSent },
              { state: 'finalized', displayLabel: PAYMENT_REQUEST_COPY.finalized.label, stepType: 'success' as TimelineStepType, info: PAYMENT_REQUEST_COPY.finalized.info },
            ];
          default:
            return [];
        }
      }

      // Standard send: Created → Pending → Claimed
      // 'pending' is a passive waiting state (token shared, nothing actively processing)
      // so it uses next-pending (clock) not current (spinner)
      switch (txState) {
        case 'prepared':
          return [
            { state: 'prepared', displayLabel: SEND_COPY.prepared.label, stepType: 'current' as TimelineStepType, info: SEND_COPY.prepared.info },
            { state: 'pending', displayLabel: SEND_COPY.pending.label, stepType: 'next-pending' as TimelineStepType },
            { state: 'finalized', displayLabel: SEND_COPY.finalized.label, stepType: 'future-small' as TimelineStepType },
          ];
        case 'pending':
          return [
            { state: 'prepared', displayLabel: SEND_COPY.prepared.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt },
            { state: 'pending', displayLabel: SEND_COPY.pending.label, stepType: 'next-pending' as TimelineStepType, info: SEND_COPY.pending.info },
            { state: 'finalized', displayLabel: SEND_COPY.finalized.label, stepType: 'future-small' as TimelineStepType },
          ];
        case 'finalized':
          return [
            { state: 'prepared', displayLabel: SEND_COPY.prepared.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt },
            { state: 'pending', displayLabel: SEND_COPY.pending.label, stepType: 'complete' as TimelineStepType, timestamp: sendTx.createdAt },
            { state: 'finalized', displayLabel: SEND_COPY.finalized.label, stepType: 'success' as TimelineStepType, info: SEND_COPY.finalized.info },
          ];
        default:
          return [];
      }
    }

    case 'receive': {
      const receiveTx = historyEntry as ReceiveHistoryEntry & { state?: string };
      const txState = receiveTx.state || 'redeemed';

      // Local-only terminal state for scans that were already redeemed elsewhere.
      if (txState === 'alreadySpent') {
        return [
          {
            state: 'pending',
            displayLabel: RECEIVE_COPY.pending.label,
            stepType: 'complete',
            timestamp: receiveTx.createdAt,
          },
          {
            state: 'alreadySpent',
            displayLabel: RECEIVE_COPY.alreadySpent.label,
            stepType: 'already-spent',
            info: RECEIVE_COPY.alreadySpent.info,
          },
        ];
      }

      // 'pending' is a waiting state — token received, needs user action to redeem
      if (txState === 'pending') {
        return [
          { state: 'pending', displayLabel: RECEIVE_COPY.pending.label, stepType: 'next-pending' as TimelineStepType, info: RECEIVE_COPY.pending.info },
          { state: 'redeemed', displayLabel: RECEIVE_COPY.redeemed.label, stepType: 'future-small' as TimelineStepType },
        ];
      }

      return [
        { state: 'pending', displayLabel: RECEIVE_COPY.pending.label, stepType: 'complete' as TimelineStepType, timestamp: receiveTx.createdAt },
        { state: 'redeemed', displayLabel: RECEIVE_COPY.redeemed.label, stepType: 'success' as TimelineStepType, info: RECEIVE_COPY.redeemed.info(receiveTx.amount) },
      ];
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
  // Waiting states (e.g. send pending): no active step, show the next milestone
  const nextUp = timeline.find((item) => item.stepType === 'next-pending');
  if (nextUp) {
    return nextUp.displayLabel.toUpperCase();
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
