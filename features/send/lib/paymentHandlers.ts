import { router } from 'expo-router';

import type {
  Manager,
  MeltHistoryEntry,
  MintHistoryEntry,
  SendHistoryEntry,
} from 'coco-cashu-core';

import type { FlowEvent, MintAvailability, StepHandlerMap } from 'coco-payment-ux';

import { useMintStore } from '@/shared/stores/profile/mintStore';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { debugLog } from '@/shared/lib/debugLog';
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
import { buildMintListItems } from '@/shared/lib/buildMintListItems';

/**
 * Computes MintAvailability status for a single mint given flow constraints.
 */
function computeAvailability(args: {
  mintUrl: string;
  balance: number;
  supportedMintUrls?: string[];
  amount?: number;
  destination?: string;
  preferredMintUrl?: string;
}): MintAvailability {
  const { mintUrl, balance, supportedMintUrls, amount, destination, preferredMintUrl } = args;

  if (destination === 'mintQuote') {
    return {
      mintUrl,
      balance,
      status: 'available',
      reason: null,
      isPreferred: mintUrl === preferredMintUrl,
    };
  }

  if (supportedMintUrls?.length && !supportedMintUrls.includes(mintUrl)) {
    return {
      mintUrl,
      balance,
      status: 'disabled',
      reason: 'NOT_IN_PAYMENT_REQUEST',
      isPreferred: mintUrl === preferredMintUrl,
    };
  }

  const needsBalance =
    destination === 'paymentRequest' || destination === 'meltQuote' || destination === 'sendEcash';

  if (needsBalance && amount != null && amount > 0) {
    if (balance <= 0) {
      return {
        mintUrl,
        balance,
        status: 'disabled',
        reason: 'NO_BALANCE',
        isPreferred: mintUrl === preferredMintUrl,
      };
    }
    if (balance < amount) {
      return {
        mintUrl,
        balance,
        status: 'disabled',
        reason: 'INSUFFICIENT_BALANCE',
        isPreferred: mintUrl === preferredMintUrl,
      };
    }
  } else if (needsBalance && balance <= 0) {
    return {
      mintUrl,
      balance,
      status: 'disabled',
      reason: 'NO_BALANCE',
      isPreferred: mintUrl === preferredMintUrl,
    };
  }

  return {
    mintUrl,
    balance,
    status: 'available',
    reason: null,
    isPreferred: mintUrl === preferredMintUrl,
  };
}

export { buildMintListItems };

interface CreateSovranHandlersConfig {
  manager: Manager;
  onSend: (event: FlowEvent) => void | Promise<void>;
  onOptionDismiss?: () => void;
}

export function createSovranHandlers({
  manager,
  onSend,
  onOptionDismiss,
}: CreateSovranHandlersConfig): StepHandlerMap {
  return {
    receiveToken: ({ token }) => {
      debugLog({
        location: 'paymentHandlers.receiveToken',
        message: 'receiveToken handler — navigating to receive',
        phase: 'before',
      });
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: { receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(token)) },
      });
    },

    confirmSend: async ({ mintUrl, amount }) => {
      debugLog({
        location: 'paymentHandlers.confirmSend',
        message: 'confirmSend handler',
        phase: 'before',
        data: { mintUrl, amount },
      });
      try {
        await manager.wallet.send(mintUrl, amount);
        const history = await manager.history.getPaginatedHistory();
        const entry = history.find(
          (h) => h.type === 'send' && (h as SendHistoryEntry).mintUrl === mintUrl
        ) as SendHistoryEntry | undefined;
        if (!entry) throw new Error('Send history entry not found after creation');
        router.navigate({
          pathname: '/(send-flow)/sendToken',
          params: { sendHistoryEntry: JSON.stringify(entry) },
        });
      } catch (err) {
        generalErrorPopup({
          text: err instanceof Error ? err.message : 'Failed to create token',
        });
      }
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
      debugLog({
        location: 'paymentHandlers.navigateToMeltPreview',
        message: 'instant navigation with synthetic entry',
        phase: 'before',
        data: { mintUrl, meltTarget, amount, unit, entryId: entry.id },
      });
      router.replace({
        pathname: '/(send-flow)/meltQuote',
        params: { meltHistoryEntry: JSON.stringify(entry) },
      });
    },

    createMintQuote: async ({ mintUrl, amount, unit }) => {
      debugLog({
        location: 'paymentHandlers.createMintQuote',
        message: 'createMintQuote handler',
        phase: 'before',
        data: { mintUrl, amount, unit },
      });
      try {
        const mintQuote = await manager.quotes.createMintQuote(mintUrl, amount);
        const history = await manager.history.getPaginatedHistory();
        const entry = history.find(
          (h) => h.type === 'mint' && (h as MintHistoryEntry).quoteId === mintQuote.quote
        ) as MintHistoryEntry | undefined;
        if (!entry) throw new Error('Mint quote history entry not found after creation');
        router.replace({
          pathname: '/(receive-flow)/mintQuote',
          params: { mintHistoryEntry: JSON.stringify(entry), unit },
        });
      } catch (err) {
        generalErrorPopup({
          text: err instanceof Error ? err.message : 'Failed to create mint quote',
        });
      }
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
      const cache = useMintStore.getState().getAllSelectedMints();
      debugLog({
        location: 'paymentHandlers.enterAmount',
        message: 'enterAmount handler — navigating to amount screen',
        phase: 'before',
        data: {
          unit,
          preselectedMintUrl: preselectedMintUrl ?? null,
          destination: constraints.destination ?? null,
          cache: { ...cache },
        },
      });
      const params: Record<string, string> = { unit };
      if (constraints.destination) params.destination = constraints.destination;
      if (preselectedMintUrl) params.selectedMintUrl = preselectedMintUrl;
      if (constraints.paymentRequest) params.paymentRequest = constraints.paymentRequest;
      if (constraints.meltTarget) params.meltTarget = constraints.meltTarget;

      const pathname =
        constraints.destination === 'mintQuote' ? '/(receive-flow)/amount' : '/(send-flow)/amount';
      router.navigate({ pathname: pathname as any, params });
    },

    selectMint: async ({
      candidates: _candidates,
      supportedMintUrls,
      amount,
      unit,
      destination,
    }) => {
      const cache = useMintStore.getState().getAllSelectedMints();
      debugLog({
        location: 'paymentHandlers.selectMint',
        message: 'selectMint handler — navigating to mint list',
        phase: 'before',
        data: {
          destination: destination ?? null,
          hasDestination: !!destination,
          unit,
          amount: amount ?? null,
          note: destination
            ? 'flow context preserved'
            : 'no destination — context was cleared to { unit }',
          cache: { ...cache },
        },
      });
      try {
        const [allTrustedMints, balances] = await Promise.all([
          manager.mint.getAllTrustedMints(),
          manager.wallet.getBalances(),
        ]);

        const availability = allTrustedMints.map((mint) =>
          computeAvailability({
            mintUrl: mint.mintUrl,
            balance: balances[mint.mintUrl] ?? 0,
            supportedMintUrls,
            amount,
            destination,
          })
        );

        const items = buildMintListItems(allTrustedMints, availability);

        const params: Record<string, string> = {
          unit,
          mintItems: JSON.stringify(items),
        };
        if (destination) params.destination = destination;

        const pathname =
          destination === 'mintQuote' ? '/(receive-flow)/mintSelect' : '/(send-flow)/mintSelect';
        router.navigate({ pathname: pathname as any, params });
      } catch (err) {
        generalErrorPopup({
          text: err instanceof Error ? err.message : 'Failed to load mints',
        });
      }
    },

    chooseOption: ({ parsed, options, unit }) => {
      paymentOptionsPopup({
        parsed,
        annotatedOptions: options,
        unit,
        onSelectOption: (option) => {
          void onSend({ type: 'OPTION_CHOSEN', option });
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
          void onSend({ type: 'PROOFS_CHOSEN', amount });
        },
      });
    },

    dismiss: () => {
      const cache = useMintStore.getState().getAllSelectedMints();
      debugLog({
        location: 'paymentHandlers.dismiss',
        message: 'dismiss handler — going back (e.g. after persist-only mint select on home)',
        phase: 'before',
        data: { note: 'flow context cleared, screen dismissed', cache: { ...cache } },
      });
      router.back();
    },

    error: ({ code, message }) => {
      debugLog({
        location: 'paymentHandlers.error',
        message: 'error handler',
        phase: 'before',
        data: { code, message },
      });
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
        default:
          generalErrorPopup({ text: message });
      }
    },
  };
}
