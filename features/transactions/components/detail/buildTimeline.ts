import { MintQuoteState, MeltQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { HistoryEntry, MintHistoryEntry } from '@cashu/coco-core';

import {
  MINT_COPY,
  MELT_COPY,
  SEND_COPY,
  PAYMENT_REQUEST_COPY,
  RECEIVE_COPY,
} from '@/shared/lib/paymentCopy';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import {
  getOnchainConfirmationInfo,
  type OnchainConfirmationProgress,
} from '@/shared/lib/bitcoin/onchainPaymentStatus';
import { meltQuoteExpired, mintHistoryEntryExpired } from '@/shared/lib/utils';

const EXPIRED_STATE = 'expired';
const FAILED_STATE = 'failed';

export type TimelineStepType =
  | 'complete'
  | 'current'
  | 'next-pending'
  | 'future-small'
  | 'expired'
  | 'rolled-back'
  | 'already-spent'
  | 'success';

export interface TimelineItem {
  state: string;
  displayLabel: string;
  stepType: TimelineStepType;
  timestamp?: number;
  info?: string;
}

interface BuildTimelineInput {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  currentTime: number;
  tokenCreated?: boolean;
  nostrSent?: boolean;
  onchainConfirmationProgress?: OnchainConfirmationProgress | null;
}

type MintTimelineState = MintQuoteState | typeof FAILED_STATE | string;

function isMintQuoteState(value: unknown): value is MintQuoteState {
  return (
    value === MintQuoteState.UNPAID ||
    value === MintQuoteState.PAID ||
    value === MintQuoteState.ISSUED
  );
}

function getMintTimelineState(historyEntry: HistoryEntry): MintTimelineState {
  if (historyEntry.type !== 'mint') return String(historyEntry.state);

  const rawState = String(historyEntry.state);
  if (rawState === 'finalized') return MintQuoteState.ISSUED;
  if (rawState === 'executing') return MintQuoteState.PAID;
  if (rawState === 'failed') return FAILED_STATE;

  const remoteState = 'remoteState' in historyEntry ? historyEntry.remoteState : undefined;
  if (isMintQuoteState(remoteState)) return remoteState;
  if (rawState === 'pending') return MintQuoteState.UNPAID;
  if (isMintQuoteState(rawState)) return rawState;
  return rawState;
}

export function buildTimeline({
  historyEntry,
  meltQuote,
  currentTime,
  tokenCreated,
  nostrSent,
  onchainConfirmationProgress,
}: BuildTimelineInput): TimelineItem[] {
  switch (historyEntry.type) {
    case 'mint': {
      const mintState = getMintTimelineState(historyEntry);
      const isOnchainMint = !!getOnchainMintAddress(historyEntry);
      const waitingInfo = isOnchainMint
        ? 'Pay the address to receive funds'
        : MINT_COPY.UNPAID.info;
      const isExpired =
        !isOnchainMint &&
        mintState === MintQuoteState.UNPAID &&
        mintHistoryEntryExpired(historyEntry);

      if (isExpired) {
        return [
          {
            state: MintQuoteState.UNPAID,
            displayLabel: MINT_COPY.UNPAID.label,
            stepType: 'complete',
            timestamp: historyEntry.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: MINT_COPY.expired.label,
            stepType: 'expired',
            info: MINT_COPY.expired.info,
          },
        ];
      }

      if (mintState === FAILED_STATE) {
        return [
          {
            state: MintQuoteState.UNPAID,
            displayLabel: MINT_COPY.UNPAID.label,
            stepType: 'complete',
            timestamp: historyEntry.createdAt,
          },
          {
            state: FAILED_STATE,
            displayLabel: MINT_COPY.failed.label,
            stepType: 'expired',
            info:
              (historyEntry as MintHistoryEntry & { error?: string }).error ??
              MINT_COPY.failed.info,
          },
        ];
      }

      switch (mintState) {
        case MintQuoteState.UNPAID:
          if (isOnchainMint && onchainConfirmationProgress?.hasPayment) {
            return [
              {
                state: MintQuoteState.UNPAID,
                displayLabel: MINT_COPY.UNPAID.label,
                stepType: 'complete',
                timestamp: historyEntry.createdAt,
              },
              {
                state: MintQuoteState.PAID,
                displayLabel: MINT_COPY.PAID.label,
                stepType: 'next-pending',
                info: getOnchainConfirmationInfo(onchainConfirmationProgress),
              },
              {
                state: MintQuoteState.ISSUED,
                displayLabel: MINT_COPY.ISSUED.label,
                stepType: 'future-small',
              },
            ];
          }

          return [
            {
              state: MintQuoteState.UNPAID,
              displayLabel: MINT_COPY.UNPAID.label,
              stepType: 'next-pending',
              info: waitingInfo,
            },
            {
              state: MintQuoteState.PAID,
              displayLabel: MINT_COPY.PAID.label,
              stepType: 'future-small',
            },
            {
              state: MintQuoteState.ISSUED,
              displayLabel: MINT_COPY.ISSUED.label,
              stepType: 'future-small',
            },
          ];
        case MintQuoteState.PAID:
          return [
            {
              state: MintQuoteState.UNPAID,
              displayLabel: MINT_COPY.UNPAID.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: MintQuoteState.PAID,
              displayLabel: MINT_COPY.PAID.label,
              stepType: 'next-pending',
              info:
                isOnchainMint && onchainConfirmationProgress
                  ? getOnchainConfirmationInfo(onchainConfirmationProgress)
                  : MINT_COPY.PAID.info,
            },
            {
              state: MintQuoteState.ISSUED,
              displayLabel: MINT_COPY.ISSUED.label,
              stepType: 'future-small',
            },
          ];
        case MintQuoteState.ISSUED:
          return [
            {
              state: MintQuoteState.UNPAID,
              displayLabel: MINT_COPY.UNPAID.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: MintQuoteState.PAID,
              displayLabel: MINT_COPY.PAID.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: MintQuoteState.ISSUED,
              displayLabel: MINT_COPY.ISSUED.label,
              stepType: 'success',
              info: MINT_COPY.ISSUED.info(amountToNumber(historyEntry.amount)),
            },
          ];
        default:
          return [];
      }
    }

    case 'melt': {
      const rawMeltState = String(historyEntry.state);
      const meltState =
        rawMeltState === 'finalized'
          ? MeltQuoteState.PAID
          : rawMeltState === 'pending' || rawMeltState === 'executing'
            ? MeltQuoteState.PENDING
            : rawMeltState === 'PAID' || rawMeltState === 'PENDING' || rawMeltState === 'UNPAID'
              ? rawMeltState
              : MeltQuoteState.UNPAID;
      const isExpired =
        meltQuote &&
        meltState === MeltQuoteState.UNPAID &&
        meltQuoteExpired(meltQuote, currentTime);

      if (isExpired) {
        return [
          {
            state: MeltQuoteState.UNPAID,
            displayLabel: MELT_COPY.UNPAID.label,
            stepType: 'complete',
            timestamp: historyEntry.createdAt,
          },
          {
            state: EXPIRED_STATE,
            displayLabel: MELT_COPY.expired.label,
            stepType: 'expired',
            info: MELT_COPY.expired.info,
          },
        ];
      }

      switch (meltState) {
        case MeltQuoteState.UNPAID:
          return [
            {
              state: MeltQuoteState.UNPAID,
              displayLabel: MELT_COPY.UNPAID.label,
              stepType: 'next-pending',
              info: MELT_COPY.UNPAID.info,
            },
            {
              state: MeltQuoteState.PENDING,
              displayLabel: MELT_COPY.PENDING.label,
              stepType: 'future-small',
            },
            {
              state: MeltQuoteState.PAID,
              displayLabel: MELT_COPY.PAID.label,
              stepType: 'future-small',
            },
          ];
        case MeltQuoteState.PENDING:
          return [
            {
              state: MeltQuoteState.UNPAID,
              displayLabel: MELT_COPY.UNPAID.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: MeltQuoteState.PENDING,
              displayLabel: MELT_COPY.PENDING.label,
              stepType: 'current',
              info: MELT_COPY.PENDING.info,
            },
            {
              state: MeltQuoteState.PAID,
              displayLabel: MELT_COPY.PAID.label,
              stepType: 'future-small',
            },
          ];
        case MeltQuoteState.PAID:
          return [
            {
              state: MeltQuoteState.UNPAID,
              displayLabel: MELT_COPY.UNPAID.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: MeltQuoteState.PENDING,
              displayLabel: MELT_COPY.PENDING.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: MeltQuoteState.PAID,
              displayLabel: MELT_COPY.PAID.label,
              stepType: 'success',
              info: MELT_COPY.PAID.info,
            },
          ];
        default:
          return [];
      }
    }

    case 'send': {
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;

      const sendState = String(historyEntry.state);
      if (sendState === 'rolledBack' || sendState === 'rolled_back') {
        const copy = isPaymentRequestMode ? PAYMENT_REQUEST_COPY : SEND_COPY;
        const rolledBackTimeline: TimelineItem[] = [
          {
            state: 'prepared',
            displayLabel: copy.prepared.label,
            stepType: 'complete',
            timestamp: historyEntry.createdAt,
          },
        ];
        if (nostrSent) {
          rolledBackTimeline.push({
            state: 'nostrSent',
            displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
            stepType: 'complete',
            timestamp: historyEntry.createdAt,
          });
        }
        rolledBackTimeline.push({
          state: 'rolledBack',
          displayLabel: copy.rolledBack.label,
          stepType: 'rolled-back',
          info: copy.rolledBack.info,
        });
        return rolledBackTimeline;
      }

      if (isPaymentRequestMode) {
        switch (historyEntry.state) {
          case 'prepared':
            return [
              {
                state: 'prepared',
                displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                stepType: tokenCreated ? 'complete' : 'next-pending',
                info: PAYMENT_REQUEST_COPY.prepared.info,
                ...(tokenCreated ? { timestamp: historyEntry.createdAt } : {}),
              },
              {
                state: 'nostrSent',
                displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                stepType: 'future-small',
              },
              {
                state: 'finalized',
                displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                stepType: 'future-small',
              },
            ];
          case 'pending':
            if (nostrSent) {
              return [
                {
                  state: 'prepared',
                  displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                  stepType: 'complete',
                  timestamp: historyEntry.createdAt,
                },
                {
                  state: 'nostrSent',
                  displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                  stepType: 'complete',
                  timestamp: historyEntry.createdAt,
                  info: PAYMENT_REQUEST_COPY.nostrSent.infoSent,
                },
                {
                  state: 'finalized',
                  displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                  stepType: 'next-pending',
                  info: SEND_COPY.pending.info,
                },
              ];
            }
            return [
              {
                state: 'prepared',
                displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                stepType: 'complete',
                timestamp: historyEntry.createdAt,
              },
              {
                state: 'nostrSent',
                displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                stepType: 'next-pending',
                info: PAYMENT_REQUEST_COPY.nostrSent.infoSending,
              },
              {
                state: 'finalized',
                displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                stepType: 'future-small',
              },
            ];
          case 'finalized':
            return [
              {
                state: 'prepared',
                displayLabel: PAYMENT_REQUEST_COPY.prepared.label,
                stepType: 'complete',
                timestamp: historyEntry.createdAt,
              },
              {
                state: 'nostrSent',
                displayLabel: PAYMENT_REQUEST_COPY.nostrSent.label,
                stepType: 'complete',
                timestamp: historyEntry.createdAt,
                info: PAYMENT_REQUEST_COPY.nostrSent.infoSent,
              },
              {
                state: 'finalized',
                displayLabel: PAYMENT_REQUEST_COPY.finalized.label,
                stepType: 'success',
                info: PAYMENT_REQUEST_COPY.finalized.info,
              },
            ];
          default:
            return [];
        }
      }

      switch (historyEntry.state) {
        case 'prepared':
          return [
            {
              state: 'prepared',
              displayLabel: SEND_COPY.prepared.label,
              stepType: 'current',
              info: SEND_COPY.prepared.info,
            },
            {
              state: 'pending',
              displayLabel: SEND_COPY.pending.label,
              stepType: 'next-pending',
            },
            {
              state: 'finalized',
              displayLabel: SEND_COPY.finalized.label,
              stepType: 'future-small',
            },
          ];
        case 'pending':
          return [
            {
              state: 'prepared',
              displayLabel: SEND_COPY.prepared.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: 'pending',
              displayLabel: SEND_COPY.pending.label,
              stepType: 'next-pending',
              info: SEND_COPY.pending.info,
            },
            {
              state: 'finalized',
              displayLabel: SEND_COPY.finalized.label,
              stepType: 'future-small',
            },
          ];
        case 'finalized':
          return [
            {
              state: 'prepared',
              displayLabel: SEND_COPY.prepared.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: 'pending',
              displayLabel: SEND_COPY.pending.label,
              stepType: 'complete',
              timestamp: historyEntry.createdAt,
            },
            {
              state: 'finalized',
              displayLabel: SEND_COPY.finalized.label,
              stepType: 'success',
              info: SEND_COPY.finalized.info,
            },
          ];
        default:
          return [];
      }
    }

    case 'receive': {
      const receiveState = String(historyEntry.state);
      if (receiveState === 'rolledBack' || receiveState === 'rolled_back') {
        return [
          {
            state: 'pending',
            displayLabel: RECEIVE_COPY.pending.label,
            stepType: 'complete',
            timestamp: historyEntry.createdAt,
          },
          {
            state: 'alreadySpent',
            displayLabel: RECEIVE_COPY.alreadySpent.label,
            stepType: 'already-spent',
            info: RECEIVE_COPY.alreadySpent.info,
          },
        ];
      }

      if (historyEntry.state === 'prepared') {
        return [
          {
            state: 'pending',
            displayLabel: RECEIVE_COPY.pending.label,
            stepType: 'next-pending',
            info: RECEIVE_COPY.pending.info,
          },
          {
            state: 'redeemed',
            displayLabel: RECEIVE_COPY.redeemed.label,
            stepType: 'future-small',
          },
        ];
      }

      return [
        {
          state: 'pending',
          displayLabel: RECEIVE_COPY.pending.label,
          stepType: 'complete',
          timestamp: historyEntry.createdAt,
        },
        {
          state: 'redeemed',
          displayLabel: RECEIVE_COPY.redeemed.label,
          stepType: 'success',
          info: RECEIVE_COPY.redeemed.info(amountToNumber(historyEntry.amount)),
        },
      ];
    }

    default:
      return [];
  }
}

export function getCardLabel(
  historyEntry: HistoryEntry,
  timeline: TimelineItem[],
  tokenCreated?: boolean,
  nostrSent?: boolean
): string {
  const isFailed = timeline.some(
    (item) =>
      item.stepType === 'expired' ||
      item.stepType === 'rolled-back' ||
      item.stepType === 'already-spent'
  );

  let status = '';

  switch (historyEntry.type) {
    case 'mint': {
      const mintState = getMintTimelineState(historyEntry);
      const hasObservedPayment = timeline.some(
        (item) =>
          item.state === MintQuoteState.PAID &&
          (item.stepType === 'next-pending' || item.stepType === 'current')
      );
      if (isFailed) {
        status = 'Failed';
      } else if (mintState === MintQuoteState.ISSUED) {
        status = 'Complete';
      } else if (mintState === MintQuoteState.PAID || hasObservedPayment) {
        status = 'In Progress';
      } else {
        status = 'Awaiting Payment';
      }
      // Intentional collapse with the 'receive' branch: a Lightning mint quote and a
      // token-redemption receive both surface to the user as 'incoming payment'.
      return `Receive • ${status}`;
    }
    case 'melt': {
      if (isFailed) {
        status = 'Failed';
      } else if (historyEntry.state === MeltQuoteState.PAID) {
        status = 'Complete';
      } else if (historyEntry.state === MeltQuoteState.PENDING) {
        status = 'In Progress';
      } else {
        status = 'Ready';
      }
      return `Send • ${status}`;
    }
    case 'send': {
      const isPaymentRequestMode = tokenCreated !== undefined || nostrSent;
      const label = isPaymentRequestMode ? 'Payment' : 'Send';
      if (historyEntry.state === 'rolledBack') {
        status = 'Cancelled';
      } else if (historyEntry.state === 'finalized') {
        status = 'Complete';
      } else if (historyEntry.state === 'pending') {
        status = 'In Progress';
      } else {
        status = 'Ready';
      }
      return `${label} • ${status}`;
    }
    case 'receive': {
      if (historyEntry.state === 'finalized') {
        status = 'Complete';
      } else if (historyEntry.state === 'rolledBack') {
        status = 'Already Spent';
      } else {
        status = 'Pending';
      }
      return `Receive • ${status}`;
    }
    default:
      return 'Transaction';
  }
}

export function getStatusHeader(timeline: TimelineItem[]): string {
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
  const nextUp = timeline.find((item) => item.stepType === 'next-pending');
  if (nextUp) {
    return nextUp.displayLabel.toUpperCase();
  }
  return timeline[timeline.length - 1]?.displayLabel.toUpperCase() || '';
}

type StatusColorType = 'default' | 'success' | 'error' | 'warning';

export function getStatusColorType(timeline: TimelineItem[]): StatusColorType {
  const hasExpired = timeline.some((item) => item.stepType === 'expired');
  const hasRolledBack = timeline.some((item) => item.stepType === 'rolled-back');
  const hasAlreadySpent = timeline.some((item) => item.stepType === 'already-spent');
  const hasSuccess = timeline.some((item) => item.stepType === 'success');

  if (hasExpired) return 'error';
  if (hasAlreadySpent) return 'warning';
  if (hasRolledBack) return 'warning';
  if (hasSuccess) return 'success';
  return 'default';
}
