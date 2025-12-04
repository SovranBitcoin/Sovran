import React, { useState, useEffect } from 'react';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useTheme } from 'providers/ThemeProvider';
import { convertTime } from 'helper/time';
import type {
  HistoryEntry,
  MintHistoryEntry,
  MeltHistoryEntry,
  SendHistoryEntry,
  ReceiveHistoryEntry,
} from 'coco-cashu-core';
import { mintHistoryEntryExpired } from 'helper/utils';
import { MintQuoteState, MeltQuoteState, MeltQuoteResponse } from '@cashu/cashu-ts';

interface HistoryEntryTimelineProps {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteResponse;
}

// Define the state progressions for each transaction type
const MINT_STATES = [MintQuoteState.UNPAID, MintQuoteState.PAID, MintQuoteState.ISSUED] as const;
const MELT_STATES = [MeltQuoteState.UNPAID, MeltQuoteState.PENDING, MeltQuoteState.PAID] as const;

// Send states from coco: 'prepared' | 'pending' | 'completed' | 'rolledBack'
// For timeline display, we show: PREPARED → PENDING → COMPLETED (or ROLLED_BACK as terminal)
const SEND_STATES = ['prepared', 'pending', 'completed'] as const;
const SEND_STATE_LABELS: Record<string, string> = {
  prepared: 'PREPARED',
  pending: 'PENDING',
  completed: 'COMPLETED',
  rolledBack: 'ROLLED BACK',
};

const EXPIRED_STATE = 'EXPIRED';

interface TimelineItem {
  state: string;
  complete: boolean;
  isCurrent: boolean;
  timestamp?: number;
}

// Helper function to check if melt quote is expired
const isMeltQuoteExpired = (meltQuote: MeltQuoteResponse, currentTime: number): boolean => {
  if (!meltQuote.expiry) return false;
  const now = Math.floor(currentTime / 1000);
  return now > meltQuote.expiry;
};

// Helper function to get time until expiry
const getTimeUntilExpiry = (meltQuote: MeltQuoteResponse, currentTime: number): string => {
  if (!meltQuote.expiry) return '';
  const now = Math.floor(currentTime / 1000);
  const timeLeft = meltQuote.expiry - now;

  if (timeLeft <= 0) return 'EXPIRED';

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

export function HistoryEntryTimeline({ historyEntry, meltQuote }: HistoryEntryTimelineProps) {
  const { getPrimaryColor, getGreenColor, getRedColor } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update time every second for real-time countdown
  useEffect(() => {
    if (meltQuote && historyEntry.type === 'melt' && meltQuote.expiry) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [meltQuote, historyEntry.type]);

  const getTimeline = (): TimelineItem[] => {
    switch (historyEntry.type) {
      case 'mint': {
        const mintTx = historyEntry as MintHistoryEntry;
        const isExpired = mintTx.state === MintQuoteState.UNPAID && mintHistoryEntryExpired(mintTx);

        if (isExpired) {
          return [
            {
              state: MintQuoteState.UNPAID,
              complete: true,
              isCurrent: false,
              timestamp: mintTx.createdAt,
            },
            { state: EXPIRED_STATE, complete: true, isCurrent: true },
          ];
        }

        const currentIndex = MINT_STATES.indexOf(mintTx.state);
        return MINT_STATES.map((state, index) => ({
          state,
          complete: index <= currentIndex,
          isCurrent: index === currentIndex,
          timestamp: index === 0 ? mintTx.createdAt : undefined,
        }));
      }

      case 'melt': {
        const meltTx = historyEntry as MeltHistoryEntry;
        const isExpired = meltQuote && isMeltQuoteExpired(meltQuote, currentTime);

        if (isExpired) {
          return [
            {
              state: MeltQuoteState.UNPAID,
              complete: true,
              isCurrent: false,
              timestamp: meltTx.createdAt,
            },
            { state: EXPIRED_STATE, complete: true, isCurrent: true },
          ];
        }

        const currentIndex = MELT_STATES.indexOf(meltTx.state);
        return MELT_STATES.map((state, index) => ({
          state,
          complete: index <= currentIndex,
          isCurrent: index === currentIndex,
          timestamp: index === 0 ? meltTx.createdAt : undefined,
        }));
      }

      case 'send': {
        const sendTx = historyEntry as SendHistoryEntry;
        const txState = sendTx.state;

        // Handle rolled back as a special terminal state
        if (txState === 'rolledBack') {
          return [
            {
              state: SEND_STATE_LABELS.prepared,
              complete: true,
              isCurrent: false,
              timestamp: sendTx.createdAt,
            },
            {
              state: SEND_STATE_LABELS.rolledBack,
              complete: true,
              isCurrent: true,
            },
          ];
        }

        // Normal send progression: prepared → pending → completed
        const currentIndex = SEND_STATES.indexOf(txState as (typeof SEND_STATES)[number]);
        return SEND_STATES.map((state, index) => ({
          state: SEND_STATE_LABELS[state],
          complete: index <= currentIndex,
          isCurrent: index === currentIndex,
          timestamp: index === 0 ? sendTx.createdAt : undefined,
        }));
      }

      case 'receive': {
        const receiveTx = historyEntry as ReceiveHistoryEntry;
        // Receive is instant - just show completed
        return [
          {
            state: 'RECEIVED',
            complete: true,
            isCurrent: true,
            timestamp: receiveTx.createdAt,
          },
        ];
      }

      default:
        return [];
    }
  };

  const timeline = getTimeline();
  const currentState = timeline.find((item) => item.isCurrent)?.state || timeline[0].state;

  // Get expiry info for melt quotes
  const getStateWithExpiry = () => {
    if (meltQuote && historyEntry.type === 'melt') {
      const expiryInfo = getTimeUntilExpiry(meltQuote, currentTime);
      if (expiryInfo) {
        return `${currentState} • ${expiryInfo}`;
      }
    }
    return currentState;
  };

  // Determine if we should show collapse/expand
  const canCollapse =
    timeline.length > 2 && timeline.every((item) => item.complete || !item.isCurrent);
  const displayTimeline =
    collapsed && canCollapse ? [timeline[0], timeline[timeline.length - 1]] : timeline;

  const getBarColor = (item: TimelineItem) => {
    // Red for expired or rolled back states
    if (item.state === EXPIRED_STATE || item.state === SEND_STATE_LABELS.rolledBack) {
      return getRedColor('400');
    }
    return item.complete ? getGreenColor('300') : getPrimaryColor('200');
  };

  const barWidth = 4.5;
  const barHeight = 48;
  const barMarginVertical = 4;
  const dotSize = barWidth;
  const dotSpacing = 8;

  return (
    <View
      blur
      className="bg-primary-800"
      style={{
        padding: 16,
        marginHorizontal: 16,
        borderRadius: 12,
      }}>
      <Text
        size={14}
        bold
        className="text-primary-200"
        style={{
          marginBottom: 8,
          textTransform: 'uppercase',
        }}>
        {getStateWithExpiry()}
      </Text>

      <View>
        {displayTimeline.map((item, index) => (
          <React.Fragment key={`${item.state}-${index}`}>
            <HStack style={{ marginVertical: 0 }} align="center">
              <View
                style={{
                  flex: 1,
                  marginVertical: barMarginVertical,
                }}>
                <HStack align="center">
                  <View
                    style={{
                      width: barWidth,
                      height: barHeight,
                      backgroundColor: getBarColor(item),
                      borderRadius: barWidth / 2,
                      opacity: item.isCurrent ? 1 : 0.5,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text size={16} bold className="text-primary-0" style={{ marginStart: 12 }}>
                      {item.state}
                    </Text>
                    {item.timestamp && (
                      <Text size={12} bold className="text-primary-300" style={{ marginStart: 12 }}>
                        {convertTime(new Date(item.timestamp))}
                      </Text>
                    )}
                  </View>
                </HStack>
              </View>
            </HStack>

            {/* Show dots when collapsed */}
            {collapsed && canCollapse && index === 0 && (
              <VStack style={{ alignItems: 'flex-start', opacity: 0.5 }}>
                {[...Array(3)].map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: dotSize,
                      height: dotSize,
                      backgroundColor: getGreenColor('300'),
                      borderRadius: dotSize / 3,
                      marginVertical: dotSpacing / 3,
                    }}
                  />
                ))}
              </VStack>
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Collapse toggle */}
      {canCollapse && (
        <TouchableOpacity onPress={() => setCollapsed(!collapsed)}>
          <Text
            size={14}
            bold
            className="text-primary-200"
            style={{
              marginTop: 8,
              textTransform: 'uppercase',
              textAlign: 'right',
            }}>
            {collapsed ? 'EXPAND' : 'COLLAPSE'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
