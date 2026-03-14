/**
 * @fileoverview Shared MeltQuote screen component
 *
 * This module provides the core UI and logic for Lightning melt quotes (sending).
 * It is used by both standalone and flow-based route wrappers.
 *
 * The Screen supports two flows:
 * 1. Viewing existing transaction: meltHistoryEntry prop provided
 * 2. Creating new quote: meltTarget + amount provided
 */

import React, { useState, useEffect, useRef } from 'react';

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
import {
  getLightningTimestamp,
  isLightningInvoice,
  requestInvoiceFromLnurl,
} from '@/shared/lib/cashu/utils';
import { paymentCancelledPopup, couldNotCancelPopup, paymentStatusPopup } from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useMeltWithHistory } from '@/features/send';
import { useBeforeRemoveCleanup } from '@/shared/hooks/useBeforeRemoveCleanup';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { MintSelector } from '@/features/wallet';
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
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

interface MeltQuoteScreenProps {
  /** For viewing existing transaction - either parsed entry or JSON string */
  meltHistoryEntry?: MeltHistoryEntry | string;
  /** BOLT11 invoice, Lightning address, or LNURL-p URL (requires amount when not BOLT11) */
  meltTarget?: string;
  /** Amount in sats (required when meltTarget is Lightning address or LNURL-p) */
  amount?: number;
  /** Mint to use for quote creation. When changed, the route wrapper remounts the screen via key. */
  selectedMintUrl?: string;
  onCancel: () => void;
  /** Callback when send is successful (after popup closes) */
  onSendSuccess?: () => void;
  /** Called when user picks a mint from the MintSelector. */
  onMintSelected?: (mintUrl: string) => void;
  /** Called when user requests to see the full mint list. */
  onRequestMintList?: () => void;
}

export function MeltQuoteScreen({
  meltHistoryEntry: meltHistoryEntryProp,
  meltTarget: meltTargetProp,
  amount: amountProp,
  selectedMintUrl: selectedMintUrlProp,
  onCancel,
  onSendSuccess,
  onMintSelected,
  onRequestMintList,
}: MeltQuoteScreenProps) {
  const manager = useManager();
  const effectiveMint = selectedMintUrlProp;

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

  // Clear payment status when leaving so retries start fresh
  const quoteIdForCleanup = createdHistoryEntry?.quoteId ?? trackedHistoryEntry?.quoteId;
  useEffect(() => {
    return () => {
      const store = usePaymentStatusStore.getState();
      if (quoteIdForCleanup && store.active?.id === quoteIdForCleanup) {
        store.setActive(null);
      }
    };
  }, [quoteIdForCleanup]);

  // The history entry to display - prefer newly created (e.g., after mint change) over initial prop
  const currentTransaction = createdHistoryEntry || trackedHistoryEntry;
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const mintInfo = useMintInfo(currentTransaction?.mintUrl ?? effectiveMint);

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

  const unit = currentTransaction?.unit || 'sat';

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

  // Resolve Lightning address / LNURL-p to BOLT11 if needed (skip when meltTarget is already BOLT11)
  useEffect(() => {
    const resolveLnurl = async () => {
      if (
        meltTargetProp &&
        amountProp &&
        !isLightningInvoice(meltTargetProp) &&
        !resolvedInvoice &&
        !hasStartedCreation.current
      ) {
        setIsResolvingLnurl(true);
        setResolutionError(null);
        try {
          const bolt11 = await requestInvoiceFromLnurl(meltTargetProp, amountProp);
          setResolvedInvoice(bolt11);
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
  }, [meltTargetProp, amountProp, resolvedInvoice]);

  // Track whether we've already stored location for the current quote
  const hasStoredLocationRef = useRef(false);

  // BOLT11 to pass to coco: meltTarget if it's BOLT11, else resolved from LNURL
  const bolt11ForCoco =
    meltTargetProp && isLightningInvoice(meltTargetProp) ? meltTargetProp : resolvedInvoice;

  // Create melt quote on mount. Mint changes are handled by the route wrapper
  // via key={flowMint}, which remounts this component with the new mint prop.
  useEffect(() => {
    const createQuote = async () => {
      if (
        bolt11ForCoco &&
        effectiveMint &&
        !currentTransaction &&
        !isCreating &&
        !hasStartedCreation.current
      ) {
        hasStartedCreation.current = true;
        hasStoredLocationRef.current = false;
        try {
          const result = await prepareMeltQuote(effectiveMint, bolt11ForCoco);

          if (result?.historyEntry?.id) {
            await captureAndStoreLocation(result.historyEntry.id);
            hasStoredLocationRef.current = true;
            useScanHistoryStore.getState().linkTransaction(bolt11ForCoco, result.historyEntry.id);
          }
        } catch (err) {
          console.error('Failed to create melt quote:', err);
        }
      }
    };
    createQuote();
  }, [bolt11ForCoco, effectiveMint, currentTransaction, isCreating, prepareMeltQuote]);

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

    const amount = currentTransaction.amount ?? displayQuote?.amount ?? 0;
    const unit = currentTransaction.unit ?? 'sat';
    const quoteId = currentTransaction.quoteId;

    // Clear any stale failed state so retry shows fresh pending
    const store = usePaymentStatusStore.getState();
    if (store.active?.id === quoteId && store.active?.state === 'failed') {
      store.setActive(null);
    }

    // Show pending toast immediately on confirm (before execute)
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
      operationId: createdOperationId ?? undefined,
    });

    try {
      // Use v3 two-step flow: if we have an operationId (created the quote ourselves),
      // use executeMeltQuote. Otherwise (viewing existing transaction), use executeMeltByQuote.
      if (createdOperationId && createdHistoryEntry?.quoteId === currentTransaction.quoteId) {
        await executeMeltQuote(createdOperationId, currentTransaction.quoteId);
      } else {
        // For existing transactions, use executeMeltByQuote directly
        await manager.quotes.executeMeltByQuote(mintUrlForPayment, currentTransaction.quoteId);
      }
      successRef.current = true;
      onSendSuccess?.();
    } catch (err) {
      store.setFailed(quoteId, err);
      throw err;
    }
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

  if (isCreating || (!currentTransaction && meltTargetProp && effectiveMint)) {
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
          <MintSelector
            width={280}
            unit={unit}
            selectedMintUrl={effectiveMint}
            onMintSelected={onMintSelected ?? (() => {})}
            onRequestMintList={onRequestMintList ?? (() => {})}
          />
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
