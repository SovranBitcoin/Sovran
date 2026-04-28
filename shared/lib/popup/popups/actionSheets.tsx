import React from 'react';
import {
  defaultDetectors,
  type AnnotatedOption,
  type PaymentMachine,
  type PaymentOptionKind,
  type StepDataMap,
} from 'coco-payment-ux';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { getEcashTokenAmount } from '@/shared/lib/cashu/utils';

import { showActionSheet } from '../bridge';
import type { ActionSheetPayloads } from '../actionSheetTypes';
import { actionMenuPopup, type ActionMenuButton } from './actionMenu';

// ---------------------------------------------------------------------------
// Full-body custom sheet — still rendered by PopupHost's CUSTOM_SHEET_CONTENT
// registry (emoji-picker has a search input + snapPoint height that the Menu
// pattern can't express).
// ---------------------------------------------------------------------------

export function emojiPickerPopup(payload: ActionSheetPayloads['emoji-picker']): void {
  showActionSheet('emoji-picker', payload);
}

// ---------------------------------------------------------------------------
// Pick-one-of-N menus — dispatched through actionMenuPopup so they share the
// canonical `Menu presentation="bottom-sheet"` surface with "Select option",
// Copy-as-Text/Emoji, and Next-as-Ecash/Lightning.
//
// Signatures match the old payload shapes so call sites in
// features/send/lib/sovranPaymentConfig.ts don't change.
// ---------------------------------------------------------------------------

const CASHU_KINDS: readonly PaymentOptionKind[] = ['paymentRequest', 'ecashToken'];
const LIGHTNING_KINDS: readonly PaymentOptionKind[] = [
  'lightningInvoice',
  'lightningAddress',
  'lnurlp',
];

function getMethodLabel(kind: PaymentOptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'Cashu';
  if (LIGHTNING_KINDS.includes(kind)) return 'Lightning';
  return kind;
}

function getMethodIcon(kind: PaymentOptionKind): string {
  if (CASHU_KINDS.includes(kind)) return 'majesticons:coins';
  if (LIGHTNING_KINDS.includes(kind)) return 'mdi:lightning-bolt';
  return 'ph:contactless-payment-fill';
}

function getOptionAmount(option: {
  kind: PaymentOptionKind;
  value: string;
  amount?: number | null;
}): number | undefined {
  if (option.amount != null && option.amount > 0) return option.amount;
  if (option.kind === 'paymentRequest') {
    return defaultDetectors.getPaymentRequestInfo(option.value)?.amount ?? undefined;
  }
  if (option.kind === 'ecashToken') return getEcashTokenAmount(option.value);
  return undefined;
}

function buildOptionButton(
  annotated: AnnotatedOption,
  unit: string,
  machine: PaymentMachine,
  extras?: { isFailed?: boolean; failedReason?: string }
): ActionMenuButton {
  const { option, status } = annotated;
  const amount = getOptionAmount(option);
  const hasAmount = amount != null && amount > 0;
  const disabled = status === 'disabled';

  return {
    text: getMethodLabel(option.kind),
    icon: getMethodIcon(option.kind),
    disabled,
    reason: extras?.isFailed
      ? (extras.failedReason ?? 'Failed')
      : (annotated.reason?.message ?? undefined),
    description: !disabled && !extras?.isFailed && status === 'recommended' ? 'Recommended' : undefined,
    isFailed: extras?.isFailed,
    suffix: hasAmount ? (
      <AmountFormatter amount={amount} unit={unit} size={16} weight="medium" />
    ) : undefined,
    onPress: () => {
      void machine.chooseOption(option);
    },
  };
}

export type PaymentOptionsPopupPayload = StepDataMap['chooseOption'] & {
  machine: PaymentMachine;
  onDismiss?: () => void;
};

export function paymentOptionsPopup(payload: PaymentOptionsPopupPayload): void {
  const { options, unit, machine, onDismiss } = payload;
  actionMenuPopup({
    title: 'Choose how to pay',
    onDismiss,
    buttons: options.map((annotated) => buildOptionButton(annotated, unit, machine)),
  });
}

export type PaymentFallbackPopupPayload = StepDataMap['chooseFallbackOption'] & {
  machine: PaymentMachine;
  onDismiss?: () => void;
};

export function paymentFallbackPopup(payload: PaymentFallbackPopupPayload): void {
  const { options, unit, failedOptionValues, lastFailedMessage, machine, onDismiss } = payload;
  const failedSet = new Set(failedOptionValues);

  actionMenuPopup({
    title: 'Payment failed — try another method',
    onDismiss,
    buttons: options.map((annotated) =>
      buildOptionButton(annotated, unit, machine, {
        isFailed: failedSet.has(annotated.option.value),
        failedReason: lastFailedMessage,
      })
    ),
  });
}

export type ProofSelectorPopupPayload = StepDataMap['chooseProofs'] & {
  machine: PaymentMachine;
};

export function proofSelectorPopup(payload: ProofSelectorPopupPayload): void {
  const { suggestions, unit, machine } = payload;
  const buttons: ActionMenuButton[] = [];

  if (suggestions?.roundUp != null) {
    buttons.push({
      text: 'Round up',
      icon: 'fluent:arrow-upload-16-filled',
      suffix: (
        <AmountFormatter
          amount={suggestions.roundUp.amount}
          unit={unit}
          size={16}
          weight="medium"
        />
      ),
      onPress: () => {
        void machine.chooseProofs(suggestions.roundUp!.amount);
      },
    });
  }

  if (suggestions?.roundDown != null) {
    buttons.push({
      text: 'Round down',
      icon: 'fluent:arrow-download-16-filled',
      suffix: (
        <AmountFormatter
          amount={suggestions.roundDown.amount}
          unit={unit}
          size={16}
          weight="medium"
        />
      ),
      onPress: () => {
        void machine.chooseProofs(suggestions.roundDown!.amount);
      },
    });
  }

  buttons.push({
    text: 'Change mint',
    icon: 'mdi:swap-horizontal',
    separator: true,
    onPress: () => {
      void machine.requestMintSelector();
    },
  });

  actionMenuPopup({
    title: 'Choose amount',
    buttons,
  });
}
