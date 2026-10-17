/**
 * @fileoverview "Choose amount": the machine's `chooseProofs` step, in the
 * picker sheet.
 *
 * The entered amount cannot be made exactly from the ecash held at the mint
 * (offline, or the mint refused the swap), so the sender picks the nearest
 * amount that can: round up, round down, or change mint where that is still
 * a way out. Each suggestion shows its amount, in the currency the amount
 * was typed in. The choice reaches the machine once the sheet has gone,
 * since a send shows the sending toast and a mint change pushes a screen.
 * Pulling the sheet down leaves the machine on this step, as before.
 */

import { View } from 'react-native';
import {
  decodeUrlOrAddress,
  isLightningInvoiceBolt11,
  type PaymentMachine,
  type StepDataMap,
} from 'wallet';

import { cashuLog } from '@/shared/lib/logger';
import { openPicker } from '@/shared/lib/picker/openPicker';
import type { PickerOption } from '@/shared/lib/picker/types';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Text } from '@/shared/ui/primitives/Text';

type ProofSelectorStep = StepDataMap['chooseProofs'];

type ProofSuggestionDisplay =
  { kind: 'sat'; amount: number; unit: string } | { kind: 'fiat'; label: string };

export function getProofSuggestionDisplay(
  amount: number,
  unit: string,
  payload: Pick<ProofSelectorStep, 'displayMetadata'>
): ProofSuggestionDisplay {
  const metadata = payload.displayMetadata;
  if (metadata?.inputMode !== 'fiat') {
    cashuLog.debug('proof.selector.display.result', {
      inputMode: metadata?.inputMode ?? 'unit',
      result: 'sat',
      amount,
      unit,
      hasBtcPrice: false,
    });
    return { kind: 'sat', amount, unit };
  }

  const fiat =
    metadata.displayAmount === amount && metadata.displayFiat != null
      ? metadata.displayFiat
      : metadata.btcPrice > 0
        ? Math.round((amount / 100_000_000) * metadata.btcPrice * 100) / 100
        : null;

  if (fiat == null) {
    cashuLog.debug('proof.selector.display.result', {
      inputMode: metadata.inputMode,
      result: 'sat',
      amount,
      unit,
      hasBtcPrice: metadata.btcPrice > 0,
    });
    return { kind: 'sat', amount, unit };
  }
  cashuLog.debug('proof.selector.display.result', {
    inputMode: metadata.inputMode,
    result: 'fiat',
    amount,
    unit,
    hasBtcPrice: metadata.btcPrice > 0,
  });
  return { kind: 'fiat', label: `${metadata.fiatSymbol ?? ''}${fiat.toFixed(2)}` };
}

export function submitProofSuggestion(machine: PaymentMachine, amount: number): void {
  cashuLog.info('proof.selector.choice', { amount });
  void machine.chooseProofs(amount);
}

export function shouldShowProofSelectorMintChange(
  payload: Pick<ProofSelectorStep, 'meltTarget' | 'paymentRequest'>
): boolean {
  const meltTarget = payload.meltTarget?.trim();
  if (!meltTarget || payload.paymentRequest) {
    cashuLog.debug('proof.selector.change_mint.result', {
      reason: !meltTarget ? 'missing-melt-target' : 'has-payment-request',
      showChangeMint: true,
      hasMeltTarget: !!meltTarget,
      hasPaymentRequest: !!payload.paymentRequest,
    });
    return true;
  }
  const isLightningTarget =
    isLightningInvoiceBolt11(meltTarget) || decodeUrlOrAddress(meltTarget) != null;
  const showChangeMint = !isLightningTarget;
  cashuLog.debug('proof.selector.change_mint.result', {
    reason: isLightningTarget ? 'lightning-target' : 'non-lightning-target',
    showChangeMint,
    hasMeltTarget: true,
    meltTargetLength: meltTarget.length,
  });
  return showChangeMint;
}

function suggestionRow(
  id: 'round-up' | 'round-down',
  title: string,
  icon: string,
  display: ProofSuggestionDisplay
): PickerOption {
  return {
    id,
    title,
    leading: { icon: { name: icon } },
    trailing: (
      <View>
        {display.kind === 'fiat' ? (
          <Text size={16} weight="medium">
            {display.label}
          </Text>
        ) : (
          <AmountFormatter amount={display.amount} unit={display.unit} size={16} weight="medium" />
        )}
      </View>
    ),
    testID: `proof-selector-${id}`,
  };
}

export function chooseProofs(stepData: ProofSelectorStep, machine: PaymentMachine): void {
  const { suggestions, unit } = stepData;
  const showChangeMint = shouldShowProofSelectorMintChange(stepData);
  cashuLog.info('proof.selector.popup', {
    unit,
    hasRoundUp: suggestions?.roundUp != null,
    hasRoundDown: suggestions?.roundDown != null,
    inputMode: stepData.displayMetadata?.inputMode ?? 'unit',
  });
  cashuLog.info('proof.selector.presented', {
    unit,
    hasRoundUp: suggestions?.roundUp != null,
    roundUpAmount: suggestions?.roundUp?.amount ?? null,
    hasRoundDown: suggestions?.roundDown != null,
    roundDownAmount: suggestions?.roundDown?.amount ?? null,
    showChangeMint,
    inputMode: stepData.displayMetadata?.inputMode ?? 'unit',
  });

  const roundUp = suggestions?.roundUp ?? null;
  const roundDown = suggestions?.roundDown ?? null;
  const picker = openPicker({
    title: 'Choose amount',
    testID: 'proof-selector',
    options: [
      ...(roundUp
        ? [
            suggestionRow(
              'round-up',
              'Round up',
              'fluent:arrow-upload-16-filled',
              getProofSuggestionDisplay(roundUp.amount, unit, stepData)
            ),
          ]
        : []),
      ...(roundDown
        ? [
            suggestionRow(
              'round-down',
              'Round down',
              'fluent:arrow-download-16-filled',
              getProofSuggestionDisplay(roundDown.amount, unit, stepData)
            ),
          ]
        : []),
      ...(showChangeMint
        ? [
            {
              id: 'change-mint',
              title: 'Change mint',
              leading: { icon: { name: 'mdi:swap-horizontal' } },
              testID: 'proof-selector-change-mint',
            },
          ]
        : []),
    ],
  });
  void picker.result.then(async (result) => {
    if (result.kind !== 'option') return;
    // A send shows the sending toast and a mint change pushes a screen;
    // both would land beneath a closing sheet.
    await picker.closed;
    if (result.id === 'round-up' && roundUp) submitProofSuggestion(machine, roundUp.amount);
    else if (result.id === 'round-down' && roundDown) {
      submitProofSuggestion(machine, roundDown.amount);
    } else if (result.id === 'change-mint') {
      cashuLog.info('proof.selector.change_mint.choice', { source: 'proof-selector' });
      void machine.requestMintSelector();
    }
  });
}
