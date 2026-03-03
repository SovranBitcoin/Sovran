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
import { Alert } from 'react-native';

import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { MeltHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import {
  HistoryEntryHeader,
  useTransactionSource,
  useHistoryEntry,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
} from '@/features/transactions';
import { getLightningTimestamp, requestInvoiceFromLnurl } from '@/shared/lib/cashu/utils';
import { paymentCancelledPopup, couldNotCancelPopup, sendSuccessPopup } from '@/shared/lib/popup';
import { useMeltWithHistory } from '@/features/send';
import { useBeforeRemoveCleanup } from '@/shared/hooks/useBeforeRemoveCleanup';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
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
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

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
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintFromStore = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  // For viewing existing transaction
  const { entry: trackedHistoryEntry, error: parseError } =
    useHistoryEntry<MeltHistoryEntry>(meltHistoryEntryProp);

  // For creating new quote
  const {
    prepareMeltQuote,
    historyEntry: createdHistoryEntry,
    quote: createdQuote,
    operationId: createdOperationId,
    isCreating,
    isPaying,
    error: meltError,
    reset: resetMeltState,
    executeMeltQuote,
    cancelMeltQuote,
  } = useMeltWithHistory();
  const [isCancelling, setIsCancelling] = useState(false);
  const successRef = useRef(false);

  // Local state for quote creation flow
  const [resolvedInvoice, setResolvedInvoice] = useState<string | null>(null);
  const [isResolvingLnurl, setIsResolvingLnurl] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const hasStartedCreation = useRef(false);
  // Track the mint URL used for the current quote
  // This ensures we always pay with the mint that created the quote
  const lastQuoteMintRef = useRef<string | null>(null);

  // Initialize lastQuoteMintRef from history entry if provided
  // This is needed for NFC flow where we pass a pre-created quote
  useEffect(() => {
    if (trackedHistoryEntry?.mintUrl && !lastQuoteMintRef.current) {
      lastQuoteMintRef.current = trackedHistoryEntry.mintUrl;
    }
  }, [trackedHistoryEntry?.mintUrl]);

  // The history entry to display - prefer newly created (e.g., after mint change) over initial prop
  const currentTransaction = createdHistoryEntry || trackedHistoryEntry;
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const mintInfo = useMintInfo(currentTransaction?.mintUrl || selectedMintFromStore);

  // The quote to display - either derived from history entry or created
  const displayQuote: MeltQuoteBolt11Response | null =
    createdQuote ||
    (currentTransaction
      ? {
          quote: currentTransaction.quoteId,
          amount: currentTransaction.amount,
          fee_reserve: 0, // Not stored in history entry
          state: currentTransaction.state,
          expiry: 0, // Not stored in history entry
          payment_preimage: null,
          change: undefined,
          request: '', // Not stored in history entry
          unit: currentTransaction.unit,
        }
      : null);

  const [unit, setUnit] = useState(currentTransaction?.unit || 'sat');

  // On back/swipe/hardware back: roll back the melt so reserved proofs are freed.
  // active: prevent leave when we have an operation (usePreventRemove works with native-stack).
  // shouldCleanup: only run rollback if we didn't just succeed; coco rejects if already finalized.
  useBeforeRemoveCleanup({
    active: !!createdOperationId,
    shouldCleanup: () => !successRef.current && !!createdOperationId,
    cleanup: () =>
      cancelMeltQuote({
        operationId: createdOperationId ?? undefined,
        mintUrl: currentTransaction?.mintUrl,
        quoteId: currentTransaction?.quoteId,
      }),
  });

  // Resolve LNURL to invoice if needed
  useEffect(() => {
    const resolveLnurl = async () => {
      if (lnUrlOrAddressProp && amountProp && !resolvedInvoice && !hasStartedCreation.current) {
        setIsResolvingLnurl(true);
        setResolutionError(null);
        try {
          const invoice = await requestInvoiceFromLnurl(lnUrlOrAddressProp, amountProp);
          setResolvedInvoice(invoice);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to resolve LNURL';
          setResolutionError(errorMessage);
          console.error('Failed to resolve LNURL:', err);
        } finally {
          setIsResolvingLnurl(false);
        }
      }
    };
    resolveLnurl();
  }, [lnUrlOrAddressProp, amountProp, resolvedInvoice]);

  // Track whether we've already stored location for the current quote
  const hasStoredLocationRef = useRef(false);

  // Create melt quote when we have an invoice (initial creation)
  useEffect(() => {
    const createQuote = async () => {
      const invoice = invoiceProp || resolvedInvoice;
      if (
        invoice &&
        selectedMintFromStore &&
        !currentTransaction &&
        !isCreating &&
        !hasStartedCreation.current
      ) {
        hasStartedCreation.current = true;
        hasStoredLocationRef.current = false; // Reset location flag for new quote
        lastQuoteMintRef.current = selectedMintFromStore;
        try {
          const result = await prepareMeltQuote(selectedMintFromStore, invoice);

          // Capture and store location right after quote creation
          if (result?.historyEntry?.id) {
            await captureAndStoreLocation(result.historyEntry.id);
            hasStoredLocationRef.current = true;

            // Link the scanned invoice to the transaction
            useScanHistoryStore.getState().linkTransaction(invoice, result.historyEntry.id);
          }
        } catch (err) {
          console.error('Failed to create melt quote:', err);
        }
      }
    };
    createQuote();
  }, [
    invoiceProp,
    resolvedInvoice,
    selectedMintFromStore,
    currentTransaction,
    isCreating,
    prepareMeltQuote,
  ]);

  // Watch for mint changes from the store (e.g., user navigated to mint list and selected a different mint)
  // This handles the case where onMintSelected callback is bypassed by navigation
  useEffect(() => {
    const invoice = invoiceProp || resolvedInvoice;

    // Only re-create quote if:
    // 1. We have an invoice
    // 2. Store mint changed from what we used for the current quote
    // 3. We're not currently creating a quote
    // 4. Current transaction is UNPAID (don't re-create for already paid quotes)
    // Note: We allow re-creation even if we started with a history entry
    // (e.g., NFC flow passes pre-created quote but user changes mint)
    if (
      invoice &&
      selectedMintFromStore &&
      lastQuoteMintRef.current &&
      selectedMintFromStore !== lastQuoteMintRef.current &&
      !isCreating &&
      currentTransaction?.state === 'UNPAID'
    ) {
      console.log(
        `Mint changed from ${lastQuoteMintRef.current} to ${selectedMintFromStore}, re-creating quote`
      );
      lastQuoteMintRef.current = selectedMintFromStore;
      resetMeltState();
      hasStartedCreation.current = false;

      // Create new quote with the newly selected mint
      prepareMeltQuote(selectedMintFromStore, invoice)
        .then(async (result) => {
          if (result?.historyEntry?.id) {
            // Re-capture location for the new transaction
            await captureAndStoreLocation(result.historyEntry.id);
            // Link the new transaction back to the original scan
            useScanHistoryStore.getState().linkTransaction(invoice, result.historyEntry.id);
          }
        })
        .catch((err) => {
          console.error('Failed to re-create melt quote after mint change:', err);
        });
    }
  }, [
    selectedMintFromStore,
    invoiceProp,
    resolvedInvoice,
    isCreating,
    currentTransaction?.state,
    prepareMeltQuote,
    resetMeltState,
  ]);

  // Handle mint selection change (called when user selects via callback, not navigation)
  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    setUnit(mint.unit.toLowerCase());
    // Re-create quote with new mint if we have an invoice
    const invoice = invoiceProp || resolvedInvoice;
    if (invoice && mint.id !== lastQuoteMintRef.current) {
      lastQuoteMintRef.current = mint.id;
      resetMeltState();
      hasStartedCreation.current = false;
      try {
        const result = await prepareMeltQuote(mint.id, invoice);
        if (result?.historyEntry?.id) {
          // Re-capture location for the new transaction
          await captureAndStoreLocation(result.historyEntry.id);
          // Link the new transaction back to the original scan
          useScanHistoryStore.getState().linkTransaction(invoice, result.historyEntry.id);
        }
      } catch (err) {
        console.error('Failed to create quote with new mint:', err);
        Alert.alert('Error', 'Failed to create quote with selected mint');
      }
    }
  };

  /**
   * Cancel the melt operation, freeing reserved proofs, then close the screen.
   * Works for both UNPAID (prepared) and PENDING (if quote is actually UNPAID on mint side).
   */
  const handleCancelMelt = async () => {
    setIsCancelling(true);
    try {
      await cancelMeltQuote({
        operationId: createdOperationId ?? undefined,
        mintUrl: currentTransaction?.mintUrl,
        quoteId: currentTransaction?.quoteId,
      });
      paymentCancelledPopup();
      onCancel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      // If the operation is already finalized/rolled back or not found, just close
      if (
        msg.includes('Cannot rollback') ||
        msg.includes('not found') ||
        msg.includes('No melt operation')
      ) {
        onCancel();
        return;
      }
      couldNotCancelPopup({ text: msg });
    } finally {
      setIsCancelling(false);
    }
  };

  // Handle pay action
  const handleMelt = async () => {
    // CRITICAL: Use the mint URL from the current transaction, not from the store
    // This ensures the quoteId and mintUrl always match
    const mintUrlForPayment = currentTransaction?.mintUrl;

    if (!currentTransaction || !mintUrlForPayment) {
      throw new Error('No transaction or mint selected');
    }

    // Use v3 two-step flow: if we have an operationId (created the quote ourselves),
    // use executeMeltQuote. Otherwise (viewing existing transaction), use executeMeltByQuote.
    if (createdOperationId && createdHistoryEntry?.quoteId === currentTransaction.quoteId) {
      await executeMeltQuote(createdOperationId, currentTransaction.quoteId);
    } else {
      // For existing transactions, use executeMeltByQuote directly
      await manager.quotes.executeMeltByQuote(mintUrlForPayment, currentTransaction.quoteId);
    }

    successRef.current = true;
    // Show success popup and close modal after
    sendSuccessPopup({ icon: 'emoji:🎉', onClose: onSendSuccess });
  };

  // Error states
  if (parseError && meltHistoryEntryProp) {
    return <ScreenErrorState title="Error" message={parseError} onGoBack={onCancel} />;
  }

  if (resolutionError) {
    return <ScreenErrorState title="Error" message={resolutionError} onGoBack={onCancel} />;
  }

  if (meltError) {
    return <ScreenErrorState title="Error" message={meltError.message} onGoBack={onCancel} />;
  }

  // Loading states
  if (isResolvingLnurl) {
    return <ScreenLoadingState message="Resolving lightning address..." />;
  }

  if (
    isCreating ||
    (!currentTransaction && (invoiceProp || lnUrlOrAddressProp) && selectedMintFromStore)
  ) {
    return <ScreenLoadingState message="Creating payment quote..." />;
  }

  // No data state
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
  const amount = displayQuote?.amount || 0;
  const feeReserve = displayQuote?.fee_reserve || 0;
  const quoteId = displayQuote?.quote || '';

  const isPending = currentTransaction.state === 'PENDING';
  const isUnpaid = currentTransaction.state === 'UNPAID';
  const isBusy = isPaying || isCreating || isCancelling;

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
            // ── UNPAID (not expired): Send only; back/swipe runs cleanup via useBeforeRemoveCleanup ──
            {
              text: isPaying ? 'Sending...' : isCreating ? 'Updating...' : 'Send',
              icon: isPaying || isCreating ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: async () => handleMelt(),
              condition: isUnpaid && !isExpired,
              disabled: isBusy,
            },
            // ── PENDING: Cancel ──
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

        {/* Fee - shown prominently since it's unique info not displayed elsewhere */}
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

        {/* Technical details - collapsed by default */}
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
              value: `${amount} ${unit.toUpperCase()}`,
            },
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
