import React from 'react';
import { popup } from '../engine';
import { PaymentStatusIcon } from '../PaymentStatusIcon';
import { NfcStepIndicator } from '../NfcStepIndicator';
import {
  useNfcProgressStore,
  type NfcProgressStatus,
} from '@/shared/stores/runtime/nfcProgressStore';

export function walletNotReadyPopup(): void {
  popup({
    message: 'Wallet not ready',
    text: 'Please try again.',
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
  });
}

export function nfcErrorPopup(params: { title: string; message: string }): void {
  popup({ message: params.title, text: params.message, icon: 'icon:mdi:nfc-off', type: 'error' });
}

const STATUS_TITLES: Record<NfcProgressStatus, string> = {
  pending: 'Hold device steady',
  confirmed: 'Payment sent',
  failed: 'Payment failed',
};

/**
 * Multi-step NFC progress sheet.
 *
 * Call once when the NFC flow begins (first phase update).
 * Subsequent phase changes update the store; the live sheet re-renders.
 */
export function nfcProgressPopup(): void {
  popup({
    message: STATUS_TITLES.pending,
    variant: 'sheet',
    dismissable: false,
    live: {
      get: () => {
        const active = useNfcProgressStore.getState().active;
        if (!active) {
          return {
            message: STATUS_TITLES.pending,
            status: 'pending' as const,
            icon: React.createElement(PaymentStatusIcon, { size: 88, status: 'pending' }),
            submessage: React.createElement(NfcStepIndicator, {
              phase: 'reading',
              status: 'pending',
            }),
          };
        }

        const { phase, status, errorMessage } = active;

        return {
          message: STATUS_TITLES[status],
          status,
          icon: React.createElement(PaymentStatusIcon, { size: 88, status }),
          submessage:
            status === 'failed' && errorMessage
              ? errorMessage
              : React.createElement(NfcStepIndicator, { phase, status }),
          ...((status === 'confirmed' || status === 'failed') && {
            duration: status === 'confirmed' ? 2500 : 3500,
          }),
        };
      },
      subscribe: (onUpdate) => useNfcProgressStore.subscribe(onUpdate),
    },
    onClose: () => {
      useNfcProgressStore.getState().reset();
    },
  });
}
