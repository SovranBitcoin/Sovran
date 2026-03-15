import { router } from 'expo-router';

import type { MeltHistoryEntry } from 'coco-cashu-core';

import type { PaymentMachine, StepHandlerMap } from 'coco-payment-ux';

import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import {
  allOptionsDisabledPopup,
  balanceTooLowPopup,
  generalErrorPopup,
  missingMeltTargetPopup,
  noAmountPopup,
  noValidMintPopup,
  offlineSendSuggestionsPopup,
  paymentOptionsPopup,
  unsupportedInputPopup,
} from '@/shared/lib/popup';

interface CreateSovranHandlersConfig {
  machine: PaymentMachine;
  onOptionDismiss?: () => void;
}

export function createSovranHandlers({
  machine,
  onOptionDismiss,
}: CreateSovranHandlersConfig): StepHandlerMap {
  return {
    receiveToken: ({ token }) => {
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    sendComplete: ({ historyEntry }) => {
      router.navigate({
        pathname: '/(send-flow)/sendToken',
        params: { sendHistoryEntry: historyEntry },
      });
    },

    navigateToMeltPreview: ({ mintUrl, meltTarget, amount, unit }) => {
      const entry: MeltHistoryEntry = {
        id: `melt-preview-${Date.now()}`,
        type: 'melt',
        createdAt: Date.now(),
        mintUrl,
        unit: unit ?? 'sat',
        quoteId: '',
        state: 'UNPAID',
        amount,
        metadata: { phase: 'preview', meltTarget },
      };
      router.replace({
        pathname: '/(send-flow)/meltQuote',
        params: { meltHistoryEntry: JSON.stringify(entry) },
      });
    },

    mintQuoteCreated: ({ historyEntry, unit }) => {
      router.replace({
        pathname: '/(receive-flow)/mintQuote',
        params: { mintHistoryEntry: historyEntry, unit },
      });
    },

    openMint: ({ url }) => {
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintUrl: url, fromScan: '1' },
      });
    },

    openProfile: ({ npub }) => {
      router.navigate({
        pathname: '/(user-flow)/profile',
        params: { npub },
      });
    },

    enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
      const params: Record<string, string> = { unit };
      if (constraints.destination) params.destination = constraints.destination;
      if (preselectedMintUrl) params.selectedMintUrl = preselectedMintUrl;
      if (constraints.paymentRequest) params.paymentRequest = constraints.paymentRequest;
      if (constraints.meltTarget) params.meltTarget = constraints.meltTarget;

      const pathname =
        constraints.destination === 'mintQuote' ? '/(receive-flow)/amount' : '/(send-flow)/amount';
      router.navigate({ pathname: pathname as any, params });
    },

    selectMint: ({ mintListItems, unit, destination }) => {
      const params: Record<string, string> = {
        unit,
        mintItems: JSON.stringify(mintListItems ?? []),
      };
      if (destination) params.destination = destination;

      const pathname =
        destination === 'mintQuote' ? '/(receive-flow)/mintSelect' : '/(send-flow)/mintSelect';
      router.navigate({ pathname: pathname as any, params });
    },

    chooseOption: ({ parsed, options, unit }) => {
      paymentOptionsPopup({
        parsed,
        annotatedOptions: options,
        unit,
        onSelectOption: (option) => {
          void machine.chooseOption(option);
        },
        onDismiss: onOptionDismiss,
      });
    },

    chooseProofs: ({ suggestions, unit }) => {
      const roundDown = suggestions?.roundDown ?? null;
      const roundUp = suggestions?.roundUp ?? null;
      offlineSendSuggestionsPopup({
        roundDown,
        roundUp,
        unit,
        onSelectAmount: (amount) => {
          void machine.chooseProofs(amount);
        },
        onChangeMint: () => {
          void machine.requestMintSelector();
        },
      });
    },

    dismiss: () => {
      router.back();
    },

    error: ({ code, message }) => {
      switch (code) {
        case 'NO_AMOUNT':
          noAmountPopup();
          break;
        case 'NO_VALID_MINT':
          noValidMintPopup({ text: message });
          break;
        case 'INSUFFICIENT_BALANCE':
        case 'NO_BALANCE':
          balanceTooLowPopup({ text: message });
          break;
        case 'UNSUPPORTED_INPUT':
          unsupportedInputPopup({ text: message });
          break;
        case 'ALL_OPTIONS_DISABLED':
          allOptionsDisabledPopup();
          break;
        case 'MISSING_MELT_TARGET':
          missingMeltTargetPopup();
          break;
        case 'SEND_FAILED':
        case 'MINT_QUOTE_FAILED':
          generalErrorPopup({ text: message });
          break;
        default:
          generalErrorPopup({ text: message });
      }
    },
  };
}
