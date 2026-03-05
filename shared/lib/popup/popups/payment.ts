import React from 'react';
import { router } from 'expo-router';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { popup } from '../engine';
import { showCustomToast } from '../bridge';
import { fmt } from '../format';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import type { PopupIcon } from '../icons';
import type { PopupTextSegment } from '../format';
import { PaymentStatusIcon } from '../PaymentStatusIcon';
import { PaymentStatusToast } from '../PaymentStatusToast';
import type { BaseOverrides, PopupOverrides, TextOverrides } from './types';

type PaymentStatusVariant = 'receive' | 'send' | 'melt' | 'receive-ecash';

type PaymentStatusCase = {
  message: string;
  submessagePending?: string;
  submessageConfirmed: (amount: number, unit: string) => string | PopupTextSegment[];
  submessageFailed: string;
  history: {
    type: 'mint' | 'send' | 'melt' | 'receive';
    idField: 'quoteId' | 'operationId' | 'id';
  };
  route: { pathname: string; paramKey: string };
};

const PAYMENT_STATUS_CASES: Record<PaymentStatusVariant, PaymentStatusCase> = {
  receive: {
    message: 'Payment received',
    submessagePending: 'Processing...',
    submessageConfirmed: (amount, unit) => fmt`Received ${{ amount, unit }}`,
    submessageFailed: 'Payment failed',
    history: { type: 'mint', idField: 'quoteId' },
    route: { pathname: '/mintQuote', paramKey: 'mintHistoryEntry' },
  },
  send: {
    message: 'Payment sent',
    submessageConfirmed: (amount, unit) => fmt`Sent ${{ amount, unit }}`,
    submessageFailed: 'Payment failed',
    history: { type: 'send', idField: 'operationId' },
    route: { pathname: '/sendToken', paramKey: 'sendHistoryEntry' },
  },
  melt: {
    message: 'Payment sent',
    submessagePending: 'Processing...',
    submessageConfirmed: (amount, unit) => fmt`Sent ${{ amount, unit }}`,
    submessageFailed: 'Payment failed',
    history: { type: 'melt', idField: 'quoteId' },
    route: { pathname: '/meltQuote', paramKey: 'meltHistoryEntry' },
  },
  'receive-ecash': {
    message: 'Payment received',
    submessagePending: 'Processing...',
    submessageConfirmed: (amount, unit) => fmt`Received ${{ amount, unit }}`,
    submessageFailed: 'Payment failed',
    history: { type: 'receive', idField: 'id' },
    route: { pathname: '/receiveToken', paramKey: 'receiveHistoryEntry' },
  },
};

const PAYMENT_STATUS_DISPLAY: 'toast' | 'sheet' = 'toast';

export function paymentStatusPopup(payload: {
  variant: PaymentStatusVariant;
  id: string;
  mintUrl: string;
  amount: number;
  unit: string;
  operationId?: string;
  receiveEntryId?: string;
}): void {
  const { variant, id, amount, unit, mintUrl, operationId, receiveEntryId } = payload;
  const config = PAYMENT_STATUS_CASES[variant];

  if (PAYMENT_STATUS_DISPLAY === 'toast') {
    showCustomToast({
      component: (toastProps) =>
        React.createElement(PaymentStatusToast, {
          ...toastProps,
          variant,
          paymentId: id,
          mintUrl,
          amount,
          unit,
          ...(operationId !== undefined && { operationId }),
          ...(receiveEntryId !== undefined && { receiveEntryId }),
        }),
      duration: 'persistent',
      onHide: () => usePaymentStatusStore.getState().setActive(null),
    });
    return;
  }

  const onPressViewTransaction = async () => {
    try {
      const manager = CocoManager.getInstance();
      const history = await manager.history.getPaginatedHistory(0, 100);
      const { type, idField } = config.history;
      const entry = history.find(
        (h) =>
          h.type === type &&
          idField in h &&
          (h as Record<string, unknown>)[idField] === id &&
          h.mintUrl === mintUrl
      );
      if (entry) {
        router.navigate({
          pathname: config.route.pathname as
            | '/mintQuote'
            | '/sendToken'
            | '/meltQuote'
            | '/receiveToken',
          params: { [config.route.paramKey]: JSON.stringify(entry) },
        });
      }
    } catch (e) {
      console.warn('Could not open transaction:', e);
    }
  };

  const confirmedButtons = [{ text: 'View Transaction', onPress: onPressViewTransaction }];

  popup({
    message: config.message,
    variant: 'sheet',
    live: {
      get: () => {
        const active = usePaymentStatusStore.getState().active;
        const isConfirmed = active?.id === id && active?.state === 'confirmed';
        const isFailed = active?.id === id && active?.state === 'failed';
        const status: 'pending' | 'confirmed' | 'failed' = isConfirmed
          ? 'confirmed'
          : isFailed
            ? 'failed'
            : 'pending';

        const submessage = isConfirmed
          ? config.submessageConfirmed(amount, unit)
          : isFailed
            ? (active?.errorMessage ?? config.submessageFailed)
            : (config.submessagePending ?? config.submessageConfirmed(amount, unit));

        return {
          message: config.message,
          status,
          submessage,
          icon: React.createElement(PaymentStatusIcon, {
            size: 88,
            status,
          }),
          ...((isConfirmed || isFailed) && {
            duration: 3000,
            ...(isConfirmed && { buttons: confirmedButtons }),
          }),
        };
      },
      subscribe: (onUpdate) => usePaymentStatusStore.subscribe(onUpdate),
    },
  });
}

export function sendSuccessPopup(overrides?: PopupOverrides): void {
  popup({
    message: 'Funds Sent',
    text: 'Funds have been sent successfully.',
    icon: 'icon:mdi:send-check',
    type: 'success',
    ...overrides,
  });
}

export function receiveSuccessPopup(
  params: { amount: number; unit: string },
  overrides?: PopupOverrides
): void {
  popup({
    message: 'Funds Received',
    text: `${params.amount} ${params.unit} has been added to your wallet.`,
    icon: 'icon:mdi:call-received',
    type: 'success',
    ...overrides,
  });
}

export function nostrPaymentSentPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Payment sent successfully via Nostr',
    icon: 'icon:mdi:send-check',
    type: 'success',
    ...overrides,
  });
}

export function paymentCancelledPopup(overrides?: TextOverrides): void {
  popup({
    message: 'Payment cancelled',
    icon: 'icon:mdi:close-circle-outline',
    type: 'success',
    text: 'Reserved proofs have been freed.',
    ...overrides,
  });
}

export function nfcEcashSharedPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'Ecash Token Shared via NFC',
    text: 'Ecash token has been shared via NFC.',
    icon: 'icon:mdi:nfc',
    type: 'success',
    ...overrides,
  });
}

export function nfcPaymentSentPopup(options: {
  text?: string | PopupTextSegment[];
  icon?: PopupIcon;
  duration?: number;
  onClose?: (data: unknown) => void;
}): void {
  popup({
    message: 'Payment sent',
    text: options.text,
    variant: 'sheet',
    icon: options.icon ?? 'icon:mdi:send-check',
    duration: options.duration ?? 2600,
    onClose: options.onClose,
  });
}

export function nfcConnectionLostPopup(overrides?: BaseOverrides): void {
  popup({
    message: 'NFC connection lost. Send was rolled back.',
    icon: 'icon:mdi:wifi-off',
    type: 'warning',
    ...overrides,
  });
}

export function nfcSendFailedPopup(options?: { text?: string; rollbackFailed?: boolean }): void {
  popup({
    message: options?.rollbackFailed ? 'NFC send failed and rollback failed' : 'NFC send failed',
    text: options?.text,
    icon: 'icon:mdi:nfc-off',
    type: 'error',
  });
}
