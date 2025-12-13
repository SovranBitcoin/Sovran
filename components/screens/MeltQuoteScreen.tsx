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
import { formatAmount } from 'helper/currency';
import { popup } from '@/helper/popup';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import WalletHeaderTitle from 'components/blocks/WalletHeaderTitle';
import { truncateMiddle } from 'helper/strings';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionLocationSection } from 'components/blocks/TransactionLocationSection';
import { useMintStore } from '@/stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { MeltHistoryEntry } from 'coco-cashu-core';
import { getLightningTimestamp, requestInvoiceFromLnurl } from '@/helper/coco/utils';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Spinner } from 'components/ui/Spinner';
import { convertTime } from 'helper/time';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { meltQuoteExpired } from 'helper/utils';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ModalLayoutWrapper } from 'app/debugModal';
import type { MeltQuoteResponse } from '@cashu/cashu-ts';
import { useMeltWithHistory } from '@/hooks/coco/useMeltWithHistory';
import { useHistoryEntry } from '@/hooks/coco/useHistoryEntry';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';

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

/** Error screen shown when transaction data is missing or invalid */
function ErrorState({ message, onCancel }: { message: string; onCancel: () => void }) {
  const { getPrimaryColor } = useTheme();

  return (
    <ModalLayoutWrapper>
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Text
          size={18}
          bold
          style={{ color: getPrimaryColor('0'), marginBottom: 16, textAlign: 'center' }}>
          Error
        </Text>
        <Text
          size={14}
          style={{ color: getPrimaryColor('300'), marginBottom: 24, textAlign: 'center' }}>
          {message}
        </Text>
        <ButtonHandler
          buttons={[
            {
              text: 'Go Back',
              icon: 'ri:arrow-left-line',
              variant: 'primary',
              onPress: async () => onCancel(),
            },
          ]}
        />
      </View>
    </ModalLayoutWrapper>
  );
}

/** Loading screen shown while creating quote */
function LoadingState({ message }: { message: string }) {
  const { getPrimaryColor } = useTheme();

  return (
    <ModalLayoutWrapper>
      <VStack style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Spinner size={32} />
        <Text size={16} style={{ color: getPrimaryColor('300'), marginTop: 16 }}>
          {message}
        </Text>
      </VStack>
    </ModalLayoutWrapper>
  );
}

export function MeltQuoteScreen({
  meltHistoryEntry: meltHistoryEntryProp,
  invoice: invoiceProp,
  lnUrlOrAddress: lnUrlOrAddressProp,
  amount: amountProp,
  onCancel,
  onSendSuccess,
}: MeltQuoteScreenProps) {
  const { getMintInfo } = useMintManagement();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintFromStore = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  // For viewing existing transaction
  const { entry: trackedHistoryEntry, error: parseError } =
    useHistoryEntry<MeltHistoryEntry>(meltHistoryEntryProp);

  // For creating new quote
  const {
    createMeltQuote,
    payMeltQuote,
    historyEntry: createdHistoryEntry,
    quote: createdQuote,
    isCreating,
    isPaying,
    error: meltError,
    reset: resetMeltState,
  } = useMeltWithHistory();

  // Local state for quote creation flow
  const [resolvedInvoice, setResolvedInvoice] = useState<string | null>(null);
  const [isResolvingLnurl, setIsResolvingLnurl] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>({});
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

  // The history entry to display - either from prop or created
  const currentTransaction = trackedHistoryEntry || createdHistoryEntry;

  // The quote to display - either derived from history entry or created
  const displayQuote: MeltQuoteResponse | null =
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

  // Load mint info
  useEffect(() => {
    const loadMintInfo = async () => {
      const mintUrl = currentTransaction?.mintUrl || selectedMintFromStore;
      if (mintUrl) {
        try {
          const info = await getMintInfo(mintUrl);
          setMintInfo(info);
        } catch (err) {
          console.error('Failed to load mint info:', err);
          setMintInfo({});
        }
      }
    };
    loadMintInfo();
  }, [currentTransaction?.mintUrl, selectedMintFromStore, getMintInfo]);

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
          const result = await createMeltQuote(selectedMintFromStore, invoice);

          // Capture and store location right after quote creation
          if (result?.historyEntry?.id) {
            await captureAndStoreLocation(result.historyEntry.id);
            hasStoredLocationRef.current = true;
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
    createMeltQuote,
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
      createMeltQuote(selectedMintFromStore, invoice).catch((err) => {
        console.error('Failed to re-create melt quote after mint change:', err);
      });
    }
  }, [
    selectedMintFromStore,
    invoiceProp,
    resolvedInvoice,
    isCreating,
    currentTransaction?.state,
    createMeltQuote,
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
        await createMeltQuote(mint.id, invoice);
      } catch (err) {
        console.error('Failed to create quote with new mint:', err);
        Alert.alert('Error', 'Failed to create quote with selected mint');
      }
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

    await payMeltQuote(mintUrlForPayment, currentTransaction.quoteId);

    // Show success popup and close modal after
    popup({
      message: 'funds_sent',
      params: { amount: currentTransaction.amount, unit: currentTransaction.unit },
      emoji: '🎉',
      onClose: onSendSuccess,
    });
  };

  // Error states
  if (parseError && meltHistoryEntryProp) {
    return <ErrorState message={parseError} onCancel={onCancel} />;
  }

  if (resolutionError) {
    return <ErrorState message={resolutionError} onCancel={onCancel} />;
  }

  if (meltError) {
    return <ErrorState message={meltError.message} onCancel={onCancel} />;
  }

  // Loading states
  if (isResolvingLnurl) {
    return <LoadingState message="Resolving lightning address..." />;
  }

  if (
    isCreating ||
    (!currentTransaction && (invoiceProp || lnUrlOrAddressProp) && selectedMintFromStore)
  ) {
    return <LoadingState message="Creating payment quote..." />;
  }

  // No data state
  if (!currentTransaction || !displayQuote) {
    return <ErrorState message="Missing transaction data. Please try again." onCancel={onCancel} />;
  }

  const isPaid = currentTransaction.state === 'PAID';
  const isExpired = displayQuote ? meltQuoteExpired(displayQuote) : false;
  const amount = displayQuote?.amount || 0;
  const feeReserve = displayQuote?.fee_reserve || 0;
  const quoteId = displayQuote?.quote || '';

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: isPaid,
            },
            {
              text: 'Cancel',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: currentTransaction.state === 'UNPAID' && !isExpired,
            },
            {
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onCancel(),
              condition: isExpired,
            },
            {
              text: isPaying ? 'Sending...' : isCreating ? 'Updating...' : 'Send',
              icon: isPaying || isCreating ? 'ri:loader-line' : 'ri:send-plane-2-fill',
              variant: 'primary',
              onPress: async () => handleMelt(),
              condition: currentTransaction.state === 'UNPAID' && !isExpired,
              disabled: isPaying || isCreating,
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
        ) : (
          <HistoryEntryRefresh
            mintInfo={mintInfo}
            historyEntry={currentTransaction}
            handleCheckStatus={async () => {}}
          />
        )}

        <TransactionLocationSection transactionId={currentTransaction.id} />

        <HistoryEntryTimeline historyEntry={currentTransaction} meltQuote={displayQuote} />

        <Section
          items={[
            {
              title: 'Date',
              value: displayQuote?.request
                ? convertTime(new Date(getLightningTimestamp(displayQuote.request) * 1000))
                : convertTime(new Date(currentTransaction.createdAt)),
            },
            { title: 'Type', value: 'Send • Lightning' },
            ...(displayQuote?.request
              ? [
                  {
                    title: 'Request',
                    value: truncateMiddle(displayQuote.request, 5),
                  },
                ]
              : []),
            { title: 'Quote', value: truncateMiddle(quoteId, 7) },
            {
              title: 'Fee',
              value: formatAmount({ amount: feeReserve, unit }),
            },
            {
              title: 'Amount',
              value: `${amount} ${unit.toUpperCase()}`,
            },
            {
              title: 'State',
              value: currentTransaction.state,
            },
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
