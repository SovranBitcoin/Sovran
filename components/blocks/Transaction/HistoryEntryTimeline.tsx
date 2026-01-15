import React, { useState, useEffect } from 'react';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { convertTime } from 'helper/time';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import Icon from 'assets/icons';
import type {
  HistoryEntry,
  MintHistoryEntry,
  MeltHistoryEntry,
  SendHistoryEntry,
  ReceiveHistoryEntry,
} from 'coco-cashu-core';
import { mintHistoryEntryExpired, getMintHistoryEntryTimeUntilExpiry } from 'helper/utils';
import { MintQuoteState, MeltQuoteState, MeltQuoteResponse } from '@cashu/cashu-ts';
import opacity from 'hex-color-opacity';

interface HistoryEntryTimelineProps {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteResponse;
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
  prepared: 'Prepared',
  nostrSent: 'Nostr Send',
  pending: 'Pending',
  finalized: 'Finalized',
  rolledBack: 'Rolled Back',
};

// Receive states: pending (in memory, not yet redeemed) → redeemed (claimed to wallet)
const RECEIVE_STATES = ['pending', 'redeemed'] as const;
const RECEIVE_STATE_LABELS: Record<string, string> = {
  pending: 'Pending',
  redeemed: 'Redeemed',
};

// Mint/Melt state display labels
const MINT_STATE_LABELS: Record<string, string> = {
  [MintQuoteState.UNPAID]: 'Unpaid',
  [MintQuoteState.PAID]: 'Paid',
  [MintQuoteState.ISSUED]: 'Issued',
};

const MELT_STATE_LABELS: Record<string, string> = {
  [MeltQuoteState.UNPAID]: 'Request processed',
  [MeltQuoteState.PENDING]: 'Pending',
  [MeltQuoteState.PAID]: 'Paid',
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
  | 'success';

interface TimelineItem {
  state: string;
  displayLabel: string;
  stepType: TimelineStepType;
  timestamp?: number;
  info?: string;
}

// ============ Timeline Components ============

interface TimelineDotProps {
  stepType: TimelineStepType;
  greenColor: string;
  redColor: string;
  orangeColor: string;
  greyColor: string;
}

function TimelineDot({ stepType, greenColor, redColor, orangeColor, greyColor }: TimelineDotProps) {
  const dotSize = 14;
  const _smallDotSize = 6;
  const iconSize = 14;

  // Future small dot
  if (stepType === 'future-small') {
    return (
      <View
        style={{
          width: iconSize / 2,
          height: iconSize / 2,
          borderRadius: iconSize / 2,
          backgroundColor: greyColor,
          marginHorizontal: iconSize / 2,
        }}
      />
    );
  }

  // Next pending with clock icon
  if (stepType === 'next-pending') {
    return (
      <View
        style={[
          {
            width: 20,
            height: 20,
            borderRadius: dotSize / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: greyColor,
          },
          // boxShadow && {
          //   shadowColor: greenColor,
          //   shadowOffset: { width: 0, height: 0 },
          //   shadowOpacity: 0.5,
          //   shadowRadius: 4,
          //   elevation: 4,
          // },
        ]}>
        <Icon name="mdi:clock-outline" color={opacity('#FFFFFF', 0.44)} size={iconSize} />
      </View>
    );
  }

  // Get background color and icon based on step type
  let backgroundColor = greenColor;
  let iconName = 'fluent:checkmark-16-filled';
  let _boxShadow = false;

  switch (stepType) {
    case 'complete':
    case 'success':
      backgroundColor = greenColor;
      iconName = 'fluent:checkmark-16-filled';
      break;
    case 'current':
      backgroundColor = greenColor;
      iconName = 'fluent:checkmark-16-filled';
      _boxShadow = true;
      break;
    case 'expired':
      backgroundColor = redColor;
      iconName = 'material-symbols:close-rounded';
      break;
    case 'rolled-back':
      backgroundColor = orangeColor;
      iconName = 'ic:round-refresh';
      break;
  }

  return (
    <View
      style={[
        {
          width: 20,
          height: 20,
          borderRadius: dotSize / 2,
          backgroundColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        // boxShadow && {
        //   shadowColor: greenColor,
        //   shadowOffset: { width: 0, height: 0 },
        //   shadowOpacity: 0.5,
        //   shadowRadius: 4,
        //   elevation: 4,
        // },
      ]}>
      <Icon name={iconName} color="#FFFFFF" size={iconSize} />
    </View>
  );
}

interface TimelineLineProps {
  lineType: 'complete' | 'future' | 'expired-gradient' | 'rolled-back-gradient';
  greenColor: string;
  redColor: string;
  orangeColor: string;
  greyColor: string;
}

function TimelineLine({
  lineType,
  greenColor,
  redColor,
  orangeColor,
  greyColor,
}: TimelineLineProps) {
  const lineWidth = 3;
  const lineHeight = 50;

  // Gradient lines for terminal states (using Rect with rounded corners for proper caps)
  if (lineType === 'expired-gradient' || lineType === 'rolled-back-gradient') {
    const endColor = lineType === 'expired-gradient' ? redColor : orangeColor;
    return (
      <Svg width={lineWidth} height={lineHeight} style={{ marginVertical: 4 }}>
        <Defs>
          <LinearGradient id={`gradient-${lineType}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={greenColor} />
            <Stop offset="100%" stopColor={endColor} />
          </LinearGradient>
        </Defs>
        <Rect
          x={0}
          y={0}
          width={lineWidth}
          height={lineHeight}
          rx={lineWidth / 2}
          ry={lineWidth / 2}
          fill={`url(#gradient-${lineType})`}
        />
      </Svg>
    );
  }

  // Solid color lines
  const color = lineType === 'complete' ? greenColor : greyColor;
  return (
    <View
      style={{
        width: lineWidth,
        height: lineHeight,
        backgroundColor: color,
        borderRadius: lineWidth / 2,
        marginVertical: 4,
      }}
    />
  );
}

// ============ Helper Functions ============

// Helper function to check if melt quote is expired
const isMeltQuoteExpired = (meltQuote: MeltQuoteResponse, currentTime: number): boolean => {
  if (!meltQuote.expiry) return false;
  const now = Math.floor(currentTime / 1000);
  return now > meltQuote.expiry;
};

// Helper function to get time until expiry for melt quotes
const getMeltQuoteTimeUntilExpiry = (meltQuote: MeltQuoteResponse, currentTime: number): string => {
  if (!meltQuote.expiry) return '';
  const now = Math.floor(currentTime / 1000);
  const timeLeft = meltQuote.expiry - now;

  if (timeLeft <= 0) return '';

  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  if (hours > 0) {
    return `expires in ${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `expires in ${minutes}m ${seconds}s`;
  } else {
    return `expires in ${seconds}s`;
  }
};

// Get card label (e.g., "MINT • AWAITING PAYMENT")
const getCardLabel = (
  historyEntry: HistoryEntry,
  timeline: TimelineItem[],
  tokenCreated?: boolean,
  nostrSent?: boolean
): string => {
  const isFailed = timeline.some(
    (item) => item.stepType === 'expired' || item.stepType === 'rolled-back'
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
      return `Mint • ${status}`;
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
        status = 'Ready to Pay';
      }
      return `Melt • ${status}`;
    }
    case 'send': {
      const sendTx = historyEntry as SendHistoryEntry;
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;
      const label = isPaymentRequestMode ? 'Payment Request' : 'Send';
      if (!tokenCreated && !nostrSent && isPaymentRequestMode) {
        status = 'Ready to Send';
      } else if (tokenCreated && !nostrSent) {
        status = 'Sending via Nostr';
      } else if (sendTx.state === 'rolledBack') {
        status = 'Rolled Back';
      } else if (sendTx.state === 'finalized') {
        status = 'Complete';
      } else if (sendTx.state === 'pending') {
        status = 'In Progress';
      } else {
        status = nostrSent ? 'Sent' : 'Prepared';
      }
      return `${label} • ${status}`;
    }
    case 'receive': {
      const receiveTx = historyEntry as ReceiveHistoryEntry & { state?: string };
      const txState = receiveTx.state || 'redeemed';
      if (txState === 'redeemed') {
        status = 'Complete';
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
      item.stepType === 'rolled-back'
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
  const hasSuccess = timeline.some((item) => item.stepType === 'success');

  if (hasExpired) return 'error';
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
  const { getPrimaryColor, getGreenColor, getRedColor } = useTheme();
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Colors
  const greenColor = getGreenColor('300');
  const redColor = getRedColor('300');
  const orangeColor = '#fb923c'; // accent-orange from spec
  const greyColor = getPrimaryColor('400');
  const primaryWhite = getPrimaryColor('0');
  const primaryGrey200 = getPrimaryColor('200');
  const primaryGrey300 = getPrimaryColor('300');

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

  // Build timeline based on transaction type
  const getTimeline = (): TimelineItem[] => {
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
            info = 'Waiting for Lightning payment';
          } else if (stepType === 'next-pending' && state === MintQuoteState.ISSUED) {
            info = 'Minting tokens...';
          } else if (stepType === 'success' && state === MintQuoteState.ISSUED) {
            info = `+${mintTx.amount} sats received`;
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
          isMeltQuoteExpired(meltQuote, currentTime);

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
            info = 'Quote ready, awaiting execution';
          } else if (stepType === 'current' && state === MeltQuoteState.PENDING) {
            info = 'Pending blockchain confirmation';
          } else if (stepType === 'success' && state === MeltQuoteState.PAID) {
            info = 'Invoice paid successfully';
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
          if (!tokenCreated && !nostrSent) {
            // Awaiting send - nothing is complete yet, prepared is next
            currentIndex = -1;
          } else if (tokenCreated && !nostrSent) {
            // Token created but Nostr not yet sent - prepared complete, nostrSent is next
            currentIndex = 0;
          } else if (nostrSent) {
            // Nostr sent - use txState to determine progress
            if (txState === 'prepared') {
              currentIndex = 1; // nostrSent is current/complete
            } else if (txState === 'pending') {
              currentIndex = 2; // pending is current
            } else if (txState === 'finalized') {
              currentIndex = 3; // finalized is current
            } else {
              currentIndex = 1;
            }
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
            info = 'Token created, ready to share';
          } else if (stepType === 'complete' && state === 'nostrSent') {
            info = 'Sent via Nostr DM';
          } else if (stepType === 'current' && state === 'nostrSent') {
            info = 'Sending via Nostr...';
          } else if (stepType === 'current' && state === 'pending') {
            info = 'Waiting for recipient to claim';
          } else if (stepType === 'success' && state === 'finalized') {
            info = 'Token claimed by recipient';
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
            info = 'Ready to redeem token';
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
  };

  const timeline = getTimeline();
  const cardLabel = getCardLabel(historyEntry, timeline, tokenCreated, nostrSent);
  const statusHeader = getStatusHeader(timeline);
  const statusColorType = getStatusColorType(timeline);

  // Get expiry info
  const getExpiryBadge = (): string | null => {
    if (historyEntry.type === 'melt' && meltQuote && !isMeltQuoteExpired(meltQuote, currentTime)) {
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
        return primaryGrey200;
    }
  };

  // Get text color for state label
  const getStateTextColor = (stepType: TimelineStepType, isFuture: boolean) => {
    if (isFuture) return primaryGrey300;
    if (stepType === 'expired') return redColor;
    if (stepType === 'rolled-back') return orangeColor;
    return primaryWhite;
  };

  return (
    <View
      // blur
      className="bg-primary-800"
      style={{
        padding: 20,
        marginHorizontal: 16,
        borderRadius: 16,
      }}>
      {/* Card Label */}
      <Text
        size={11}
        bold
        style={{
          color: primaryGrey300,
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
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

          // Calculate margin to align text with dot center
          // Normal dots (14px): text needs -3px to align with center
          // Small dots (6px): text needs more negative margin since dot is smaller
          const contentMarginTop = item.stepType === 'future-small' ? -7 : -3;

          return (
            <View key={`${item.state}-${index}`}>
              <HStack align="flex-start">
                {/* Timeline Indicator Column */}
                <VStack align="center" style={{ marginRight: 14 }}>
                  <TimelineDot
                    stepType={item.stepType}
                    greenColor={greenColor}
                    redColor={redColor}
                    orangeColor={orangeColor}
                    greyColor={greyColor}
                  />
                  {lineType && (
                    <TimelineLine
                      lineType={lineType}
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
                    <Text
                      size={13}
                      style={{
                        color: primaryGrey200,
                      }}>
                      {convertTime(new Date(item.timestamp))}
                    </Text>
                  )}
                  {item.info && (
                    <Text
                      size={12}
                      style={{
                        color: primaryGrey200,
                        marginTop: 2,
                      }}>
                      {item.info}
                    </Text>
                  )}
                </VStack>
              </HStack>
            </View>
          );
        })}
      </View>
    </View>
  );
}
