/**
 * @fileoverview "Choose how to pay": which of the ways a scanned or pasted
 * destination can be paid, in the picker sheet.
 *
 * The machine's `chooseOption` step lists every method the destination
 * carries (a BIP-321 URI can name several); `chooseFallbackOption` lists
 * them again after one failed, with the failed one dimmed in the danger
 * colour and its reason beneath it. A row hands the option to the machine
 * once the sheet has gone, since the next step navigates or shows a toast.
 * Pulling the sheet down tells the opener, so a camera can resume scanning.
 */

import { View } from 'react-native';
import {
  decodeEcashTokenMetadata,
  defaultDetectors,
  type AnnotatedOption,
  type PaymentMachine,
  type StepDataMap,
} from 'wallet';

import { describeWalletFailure } from '@/shared/lib/errors';
import { cashuLog } from '@/shared/lib/logger';
import { openPicker } from '@/shared/lib/picker/openPicker';
import type { PickerOption } from '@/shared/lib/picker/types';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';

import { getMethodIcon, getMethodLabel } from './paymentMethodPresentation';

function getOptionAmount(option: AnnotatedOption['option']): number | undefined {
  if (option.amount != null && option.amount > 0) {
    cashuLog.debug('payment.options.amount.result', {
      kind: option.kind,
      source: 'option.amount',
      hasAmount: true,
      amount: option.amount,
    });
    return option.amount;
  }
  if (option.kind === 'paymentRequest') {
    const amount = defaultDetectors.getPaymentRequestInfo(option.value)?.amount ?? undefined;
    cashuLog.debug('payment.options.amount.result', {
      kind: option.kind,
      source: 'payment-request-info',
      hasAmount: amount != null,
      valueLength: option.value.length,
      amount,
    });
    return amount;
  }
  if (option.kind === 'ecashToken') {
    const amount = decodeEcashTokenMetadata(option.value)?.amount;
    cashuLog.debug('payment.options.amount.result', {
      kind: option.kind,
      source: 'ecash-token',
      hasAmount: amount != null,
      valueLength: option.value.length,
      amount,
    });
    return amount;
  }
  cashuLog.debug('payment.options.amount.result', {
    kind: option.kind,
    source: 'none',
    hasAmount: false,
    valueLength: option.value.length,
  });
  return undefined;
}

/**
 * Row identity from the option's kind plus the BIP-321 param it came from
 * (`payment-option-onchainAddress`, `payment-option-lightningInvoice-lightning`).
 * The value itself is the invoice/address and must not surface in the AX tree.
 */
function paymentOptionTestID(option: AnnotatedOption['option']): string {
  return option.paramKey
    ? `payment-option-${option.kind}-${option.paramKey}`
    : `payment-option-${option.kind}`;
}

/** The attempt that brought the list back, for `chooseFallbackOption`. */
interface FailedAttempt {
  values: ReadonlySet<string>;
  message?: string;
  authored?: boolean;
}

/**
 * A row's id is the option's position, never its value: an ecash option's
 * value is the bearer token, which stays out of the sheet's store.
 */
function paymentOptionRow(
  annotated: AnnotatedOption,
  index: number,
  unit: string,
  failed: FailedAttempt | undefined
): PickerOption {
  const { option, status } = annotated;
  const amount = getOptionAmount(option);
  const isFailed = failed?.values.has(option.value) === true;
  const disabled = status === 'disabled' || isFailed;
  const description = isFailed
    ? failed?.message
      ? describeWalletFailure({ message: failed.message, authored: failed.authored })
      : 'Failed'
    : disabled
      ? annotated.reason?.message
      : status === 'recommended'
        ? 'Recommended'
        : undefined;
  return {
    id: String(index),
    title: getMethodLabel(option.kind),
    leading: { icon: { name: getMethodIcon(option.kind) } },
    ...(description ? (disabled ? { reason: description } : { description }) : {}),
    disabled,
    isCaution: isFailed,
    ...(amount != null && amount > 0
      ? {
          trailing: (
            <View>
              <AmountFormatter amount={amount} unit={unit} size={16} weight="medium" />
            </View>
          ),
        }
      : {}),
    testID: paymentOptionTestID(option),
  };
}

interface PaymentOptionsRequest {
  options: readonly AnnotatedOption[];
  unit: string;
  machine: PaymentMachine;
  /** The sheet went without a choice; the machine is still on this step. */
  onDismiss?: () => void;
  failed?: FailedAttempt;
}

function showPaymentOptions({ options, unit, machine, onDismiss, failed }: PaymentOptionsRequest) {
  const isFallback = failed !== undefined;
  const failedCount = failed?.values.size ?? 0;
  cashuLog.info('payment.options.presented', {
    isFallback,
    optionCount: options.length,
    failedCount,
    optionKinds: options.map((option) => option.option.kind),
    recommendedCount: options.filter((option) => option.status === 'recommended').length,
    disabledCount: options.filter((option) => option.status === 'disabled').length,
  });
  const picker = openPicker({
    title: isFallback ? 'Payment failed — try another method' : 'Choose how to pay',
    options: options.map((annotated, index) => paymentOptionRow(annotated, index, unit, failed)),
    testID: 'payment-options',
  });
  void picker.result.then(async (result) => {
    const annotated = result.kind === 'option' ? options[Number(result.id)] : undefined;
    if (!annotated) {
      cashuLog.info('payment.options.dismissed', {
        isFallback,
        optionCount: options.length,
        failedCount,
        hasLastFailedMessage: !!failed?.message,
      });
      onDismiss?.();
      return;
    }
    cashuLog.info('payment.options.choice', {
      isFallback,
      kind: annotated.option.kind,
      status: annotated.status,
      isFailed: failed?.values.has(annotated.option.value) === true,
      valueLength: annotated.option.value.length,
      hasAmount: getOptionAmount(annotated.option) != null,
    });
    // The step this leads to pushes a screen or shows a toast; both would
    // land beneath a closing sheet.
    await picker.closed;
    void machine.chooseOption(annotated.option);
  });
}

export function choosePaymentOption(
  stepData: StepDataMap['chooseOption'],
  machine: PaymentMachine,
  onDismiss?: () => void
): void {
  cashuLog.info('payment.options.popup', {
    isFallback: false,
    optionCount: stepData.options.length,
    optionKinds: stepData.options.map((option) => option.option.kind),
  });
  showPaymentOptions({ options: stepData.options, unit: stepData.unit, machine, onDismiss });
}

export function chooseFallbackPaymentOption(
  stepData: StepDataMap['chooseFallbackOption'],
  machine: PaymentMachine,
  onDismiss?: () => void
): void {
  cashuLog.info('payment.options.popup', {
    isFallback: true,
    optionCount: stepData.options.length,
    failedCount: stepData.failedOptionValues.length,
    optionKinds: stepData.options.map((option) => option.option.kind),
  });
  showPaymentOptions({
    options: stepData.options,
    unit: stepData.unit,
    machine,
    onDismiss,
    failed: {
      values: new Set(stepData.failedOptionValues),
      message: stepData.lastFailedMessage,
      authored: stepData.lastFailedAuthored,
    },
  });
}
