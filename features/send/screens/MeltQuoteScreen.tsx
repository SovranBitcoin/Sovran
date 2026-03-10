/**
 * @fileoverview Shared MeltQuote screen component
 *
 * This module provides the core UI and logic for Lightning melt quotes (sending).
 * It is used by both standalone and flow-based route wrappers.
 *
 * The Screen supports two flows:
 * 1. Viewing existing transaction: meltHistoryEntry prop provided
 * 2. Creating new quote: invoice or lnUrlOrAddress + amount provided
 */

import React, { useState, useEffect, useRef } from 'react';

import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { MeltHistoryEntry } from 'coco-cashu-core';

import {
  HistoryEntryHeader,
  useTransactionSource,
  useHistoryEntry,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
} from '@/features/transactions';
import { getLightningTimestamp } from '@/shared/lib/cashu/utils';
import {
  paymentCancelledPopup,
  paymentStatusPopup,
} from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';
import { useBeforeRemoveCleanup } from '@/shared/hooks/useBeforeRemoveCleanup';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { WalletHeaderTitle } from '@/features/wallet';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { Section } from '@/shared/ui/composed/Section';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { convertTime } from '@/shared/lib/time';
import { meltQuoteExpired } from '@/shared/lib/utils';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

interface MeltQuoteScreenProps {
  /** For viewing existing transaction - either parsed entry or JSON string */
  meltHistoryEntry?: MeltHistoryEntry | string;
  /** Direct Lightning invoice for creating new quote */
  invoice?: string;
  /** Lightning address or LNURL for creating new quote (requires amount) */
  lnUrlOrAddress?: string;
  /** Amount in sats (required when using lnUrlOrAddress) */
  amount?: number;
  onCancel: () => void;
  /** Callback when send is successful (after popup closes) */
  onSendSuccess?: () => void;
}

export function MeltQuoteScreen({
  meltHistoryEntry: meltHistoryEntryProp,
  invoice: invoiceProp,
  lnUrlOrAddress: lnUrlOrAddressProp,
  amount: amountProp,
  onCancel,
  onSendSuccess,
}: MeltQuoteScreenProps) {
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintFromStore = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  // For viewing existing transaction
  const { entry: trackedHistoryEntry, error: parseError } =
    useHistoryEntry<MeltHistoryEntry>(meltHistoryEntryProp);

  const successRef = useRef(false);
  const autoStartFiredRef = useRef(false);

  // Stable ref for melt quoteId — read by onError callback closure
  const meltQuoteIdRef = useRef<string | null>(null);

  const meltMachine = usePaymentMachine({
    sendBranch: 'melt',
    mintUrl: selectedMintFromStore ?? null,
    amount: amountProp,
    lnUrlOrAddress: lnUrlOrAddressProp ?? null,
    invoice: invoiceProp ?? null,
    onSuccess: () => {
      successRef.current = true;
      onSendSuccess?.();
    },
    onError: (error) => {
      const quoteId = meltQuoteIdRef.current;
      if (quoteId) {
        usePaymentStatusStore.getState().setFailed(quoteId, error);
      }
    },
    onCancelled: () => {
      paymentCancelledPopup();
      onCancel();
    },
  });

  // Keep meltQuoteIdRef current for the onError callback closure
  const derivedQuoteId =
    meltMachine.meltHistoryEntry?.quoteId ?? trackedHistoryEntry?.quoteId ?? null;
  useEffect(() => {
    meltQuoteIdRef.current = derivedQuoteId;
  });

  // Auto-start the melt flow when opened directly with an invoice or lnUrlOrAddress
  const { isIdle: meltIsIdle, next: meltNext, context: meltContext } = meltMachine;
  useEffect(() => {
    if (autoStartFiredRef.current) return;
    if (meltHistoryEntryProp) return;
    if (!invoiceProp && !lnUrlOrAddressProp) return;
    if (!meltIsIdle) return;
    if (!meltContext.manager) return;
    if (!meltContext.mintUrl) return;
    autoStartFiredRef.current = true;
    meltNext();
  }, [meltIsIdle, meltNext, meltContext.manager, meltContext.mintUrl, invoiceProp, lnUrlOrAddressProp, meltHistoryEntryProp]);

  // Sync mint selection from store to machine
  useEffect(() => {
    if (
      selectedMintFromStore &&
      meltMachine.context.mintUrl &&
      selectedMintFromStore !== meltMachine.context.mintUrl
    ) {
      meltMachine.changeMint(selectedMintFromStore, 0);
    }
  }, [selectedMintFromStore, meltMachine]);

  // Clear payment status when leaving (React-lifecycle-specific)
  const quoteIdForCleanup = meltMachine.meltHistoryEntry?.quoteId ?? trackedHistoryEntry?.quoteId;
  useEffect(() => {
    return () => {
      if (successRef.current) return;
      const store = usePaymentStatusStore.getState();
      if (quoteIdForCleanup && store.active?.id === quoteIdForCleanup) {
        store.setActive(null);
      }
    };
  }, [quoteIdForCleanup]);

  // Derived state
  const currentTransaction = meltMachine.meltHistoryEntry || trackedHistoryEntry;
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const mintInfo = useMintInfo(currentTransaction?.mintUrl || selectedMintFromStore);

  const displayQuote: MeltQuoteBolt11Response | null =
    meltMachine.quote ||
    (currentTransaction
      ? {
          quote: currentTransaction.quoteId,
          amount: currentTransaction.amount,
          fee_reserve: 0,
          state: currentTransaction.state,
          expiry: 0,
          payment_preimage: null,
          change: undefined,
          request: '',
          unit: currentTransaction.unit,
        }
      : null);

  const [unit, setUnit] = useState(currentTransaction?.unit || 'sat');

  // Handle mint selection from UI
  const handleMintSelected = (mint: { id: string; unit: string }) => {
    setUnit(mint.unit.toLowerCase());
    meltMachine.changeMint(mint.id, 0);
  };

  // Cleanup on back/swipe
  useBeforeRemoveCleanup({
    active: !!meltMachine.meltOperationId,
    shouldCleanup: () => !successRef.current && !!meltMachine.meltOperationId,
    cleanup: async () => { meltMachine.cancel(); },
  });

  const handleCancelMelt = () => {
    meltMachine.cancel();
  };

  // Handle Pay — show optimistic toast then delegate to machine
  const handleMelt = () => {
    const mintUrlForPayment = currentTransaction?.mintUrl;
    if (!currentTransaction || !mintUrlForPayment) return;

    const amount = currentTransaction.amount ?? displayQuote?.amount ?? 0;
    const quoteId = currentTransaction.quoteId;

    // Show optimistic payment status toast immediately
    const store = usePaymentStatusStore.getState();
    if (store.active?.id === quoteId && store.active?.state === 'failed') {
      store.setActive(null);
    }
    store.setActive({
      variant: 'melt',
      id: quoteId,
      mintUrl: mintUrlForPayment,
      amount,
      unit,
      state: 'processing',
    });
    paymentStatusPopup({
      variant: 'melt',
      id: quoteId,
      mintUrl: mintUrlForPayment,
      amount,
      unit,
      operationId: meltMachine.meltOperationId ?? undefined,
    });

    meltMachine.execute();
  };


  // Error States
  if (parseError && meltHistoryEntryProp) {
    return <ScreenErrorState title="Error" message={parseError} onGoBack={onCancel} />;
  }

  // Machine Errors
  if (meltMachine.isError) {
    const msg = meltMachine.error?.message || 'Unknown error';
    return <ScreenErrorState title="Error" message={msg} onGoBack={onCancel} />;
  }

  // Loading States
  if (meltMachine.isResolvingLnUrl) {
    return <ScreenLoadingState message="Resolving lightning address..." />;
  }

  if (meltMachine.isPreparingQuote || meltMachine.isValidating) {
    return <ScreenLoadingState message="Creating payment quote..." />;
  }

  // No Data State
  if (!currentTransaction || !displayQuote) {
    return (
      <ScreenErrorState
        title="Error"
        message="Missing transaction data. Please try again."
        onGoBack={onCancel}
      />
    );
  }

  const isPaid = currentTransaction.state === 'PAID';
  const isExpired = displayQuote ? meltQuoteExpired(displayQuote) : false;
  const feeReserve = displayQuote?.fee_reserve || 0;
  const quoteId = displayQuote?.quote || '';

  const isPending = currentTransaction.state === 'PENDING';
  const isUnpaid = currentTransaction.state === 'UNPAID';
  
  const isExecuting = meltMachine.isExecuting;
  const isCancelling = meltMachine.isCancelling;
  const isBusy = isExecuting || meltMachine.isPreparingQuote || isCancelling;

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            // ── PAID ──
            {
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: isPaid,
            },
            // ── UNPAID ──
            {
              text: isExecuting ? 'Sending...' : meltMachine.isPreparingQuote ? 'Updating...' : 'Send',
              icon: isExecuting || meltMachine.isPreparingQuote ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: async () => handleMelt(),
              condition: isUnpaid && !isExpired,
              disabled: isBusy,
            },
            // ── PENDING ──
            {
              text: isCancelling ? 'Cancelling...' : 'Cancel',
              icon: isCancelling ? 'ri:loader-line' : 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => handleCancelMelt(),
              condition: isPending,
              disabled: isBusy,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={currentTransaction} />

        {currentTransaction.state === 'UNPAID' && !isExpired ? (
          <WalletHeaderTitle width={280} unit={unit} onMintSelected={handleMintSelected} />
        ) : mintInfo ? (
          <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={currentTransaction} />
        ) : null}

        {isPaid && <TransactionLocationSection transactionId={currentTransaction.id} />}

        <HistoryEntryTimeline historyEntry={currentTransaction} meltQuote={displayQuote} />

        {feeReserve > 0 ? (
          <Section
            items={[
              {
                title: 'Fee',
                value: formatAmount({ amount: feeReserve, unit }),
              },
            ]}
          />
        ) : null}

        <DetailsSection
          items={[
            ...(sourceLabel ? [{ title: 'Source', value: sourceLabel }] : []),
            {
              title: 'Date',
              value: displayQuote?.request
                ? convertTime(new Date(getLightningTimestamp(displayQuote.request) * 1000))
                : convertTime(new Date(currentTransaction.createdAt)),
            },
            ...(displayQuote?.request
              ? [
                  {
                    title: 'Invoice',
                    value: truncateMiddle(displayQuote.request, 5),
                  },
                ]
              : []),
            { title: 'Quote ID', value: truncateMiddle(quoteId, 7) },
            {
              title: 'Amount',
              value: `${(displayQuote?.amount ?? 0)} ${unit.toUpperCase()}`,
            },
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
