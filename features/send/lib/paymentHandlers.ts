import { router } from 'expo-router';

import type { MeltHistoryEntry } from 'coco-cashu-core';

import type { PaymentMachine, StepHandlerMap } from 'coco-payment-ux';

import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { proofSelectorPopup, paymentOptionsPopup } from '@/shared/lib/popup';

interface CreateSovranHandlersConfig {
  machine: PaymentMachine;
  onOptionDismiss?: () => void;
}

export function createSovranHandlers({
  machine,
  onOptionDismiss,
}: CreateSovranHandlersConfig): StepHandlerMap {
  return {
    // { token }
    receiveToken: ({ token }) => {
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    // { historyEntry }
    sendComplete: ({ historyEntry }) => {
      router.navigate({
        pathname: '/(send-flow)/sendToken',
        params: { sendHistoryEntry: historyEntry },
      });
    },

    // { mintUrl, paymentRequest, amount, unit }
    navigateToPaymentRequest: ({ mintUrl, paymentRequest, amount, unit }) => {
      const entry = {
        id: `pr-preview-${Date.now()}`,
        type: 'send',
        createdAt: Date.now(),
        mintUrl,
        amount,
        unit,
        state: 'prepared',
        metadata: {
          paymentRequest,
          phase: 'preview',
        },
      };
      router.navigate({
        pathname: '/(send-flow)/paymentRequest' as any, // new route not yet in generated types
        params: { paymentRequestEntry: JSON.stringify(entry) },
      });
    },

    // { mintUrl, meltTarget, unit, amount }
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

    // { historyEntry, unit }
    mintQuoteCreated: ({ historyEntry, unit }) => {
      router.replace({
        pathname: '/(receive-flow)/mintQuote',
        params: { mintHistoryEntry: historyEntry, unit },
      });
    },

    // { url }
    openMint: ({ url }) => {
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: { mintUrl: url, fromScan: '1' },
      });
    },

    // { npub }
    openProfile: ({ npub }) => {
      router.navigate({
        pathname: '/(user-flow)/profile',
        params: { npub },
      });
    },

    // { unit, preselectedMintUrl?, constraints: { destination, supportedMintUrls?, paymentRequest?, meltTarget? } }
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

    // { candidates, supportedMintUrls?, amount?, unit, paymentRequest?, meltTarget?, destination?, mintListItems? }
    selectMint: ({
      candidates: _candidates,
      supportedMintUrls: _supportedMintUrls,
      amount: _amount,
      unit,
      paymentRequest: _paymentRequest,
      meltTarget: _meltTarget,
      destination,
      mintListItems,
    }) => {
      const params: Record<string, string> = {
        unit,
        mintItems: JSON.stringify(mintListItems ?? []),
      };
      if (destination) params.destination = destination;

      const pathname =
        destination === 'mintQuote' ? '/(receive-flow)/mintSelect' : '/(send-flow)/mintSelect';
      router.navigate({ pathname: pathname as any, params });
    },

    // { parsed, options, unit }
    chooseOption: (stepData) => {
      paymentOptionsPopup({ ...stepData, machine, onDismiss: onOptionDismiss });
    },

    // { mintUrl, amount, paymentRequest?, meltTarget?, unit, proofAmounts, suggestions? }
    chooseProofs: (stepData) => {
      proofSelectorPopup({ ...stepData, machine });
    },

    dismiss: () => {
      router.back();
    },
  };
}
