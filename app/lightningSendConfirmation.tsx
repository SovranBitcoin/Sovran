import React, { useState, useEffect } from 'react';
import { formatAmount } from 'helper/currency';
import { useCashuUtilities, useMintManagement, useMelt } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { VStack, HStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import { handleBarcode } from 'helper/payment-handler/handlers';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { usePaginatedHistory } from 'coco-cashu-react';
import type { MeltHistoryEntry } from 'coco-cashu-core';
import { MintQuoteTimeline } from './lightningReceiveConfirmation';

export function LightningSendConfirmation({
  meltHistoryEntry,
  extraButtons = [],
}: {
  meltHistoryEntry: MeltHistoryEntry;
  extraButtons?: ButtonHandlerButton[];
}) {
  const { getLightningDescription, getLightningTimestamp } = useCashuUtilities();
  const { history } = usePaginatedHistory();
  const { melt, isLoading: isMelting, error: meltError, reset: resetMelt } = useMelt();

  const [_meltQuote, setMeltQuote] = useState(
    'meltQuote' in meltHistoryEntry
      ? JSON.stringify((meltHistoryEntry as any).meltQuote)
      : undefined
  );
  const [unit, setUnit] = useState(meltHistoryEntry.unit);
  const parsedQuote =
    ('meltQuote' in meltHistoryEntry ? (meltHistoryEntry as any).meltQuote : {}) || {};
  const amount = parsedQuote?.amount || meltHistoryEntry.amount;
  const feeReserve = parsedQuote?.fee_reserve;
  const quoteId = meltHistoryEntry.quoteId;

  const { getMintInfo } = useMintManagement();
  const selectedMintUrl = meltHistoryEntry.mintUrl;
  const [mintInfo, setMintInfo] = React.useState<any>({});

  // Find the current transaction using Coco's history system
  // MeltHistoryEntry stores quoteId, not the payment request
  const currentTransaction = history.find(
    (tx) => tx.type === 'melt' && (tx as MeltHistoryEntry).quoteId === quoteId
  ) as MeltHistoryEntry | undefined;

  // Load mint info when transaction is found
  useEffect(() => {
    const loadMintInfo = async () => {
      if (currentTransaction?.mintUrl) {
        try {
          const info = await getMintInfo(currentTransaction.mintUrl);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      } else if (selectedMintUrl) {
        try {
          const info = await getMintInfo(selectedMintUrl);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      }
    };
    loadMintInfo();
  }, [currentTransaction?.mintUrl, selectedMintUrl, getMintInfo]);

  const handleMintSelected = async (mint: any, balance: any) => {
    const pr =
      'paymentRequest' in meltHistoryEntry ? (meltHistoryEntry as any).paymentRequest : undefined;
    if (pr) {
      // Avoid UI bugs with setTimeout
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = await handleBarcode({
        scanning: { data: pr },
        selectedMint: mint.id,
        unit: mint.unit.toLowerCase(),
        setProgress: () => {},
        setLoading: () => {},
        setScanned: () => {},
        balance: balance?.amount,
      });
      if (result.isOk() && result.value) {
        // Note: Mint selection now handled by Coco
        setMeltQuote(result.value.params.meltQuote);
        setUnit(result.value.params.unit);
      } else {
        throw new Error('mint_change_failed');
      }
    } else {
      // Note: Mint selection now handled by Coco
      setUnit(mint.unit.toLowerCase());
    }
  };

  const handleMelt = async () => {
    try {
      resetMelt(); // Clear any previous errors

      if (!selectedMintUrl) {
        throw new Error('No mint selected');
      }

      const pr =
        'paymentRequest' in meltHistoryEntry ? (meltHistoryEntry as any).paymentRequest : undefined;
      if (!pr) {
        throw new Error('No payment request available');
      }

      // Melt tokens to pay the Lightning invoice
      await melt(selectedMintUrl, pr);

      // Payment successful - the transaction will appear in history automatically
      // via Coco's event system
    } catch (error) {
      console.error('Failed to melt tokens:', error);
      // Error is handled by the melt hook and will be displayed in the UI
    }
  };

  const handleCancel = () => {
    router.dismissAll();
    router.push('/(drawer)/(tabs)');
  };

  const isPaid = currentTransaction?.state === 'PAID';
  const hasTransaction = !!currentTransaction;

  // Create a synthetic history entry for pre-send mode
  const displayTransaction: MeltHistoryEntry = currentTransaction || {
    id: 'pending',
    type: 'melt',
    quoteId: quoteId || 'pending',
    state: 'UNPAID',
    amount: amount || 0,
    unit: unit,
    mintUrl: selectedMintUrl || '',
    createdAt: Date.now(),
    metadata: {},
  };

  const getCurrencyDisplay = () => (unit === 'sat' ? 'BTC' : unit.toUpperCase());
  return (
    <Modal
      showClose
      title="Send Lightning"
      buttons={
        <HStack className="pb-2" justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => handleCancel(),
                condition: isPaid,
              },
              {
                text: 'View Message',
                icon: 'ri:message-2-line',
                variant: 'primary',
                onPress: async () => {
                  const nostrPubkey = currentTransaction?.metadata?.nostr as string;
                  if (nostrPubkey) {
                    router.push({
                      pathname: '/userMessages',
                      params: {
                        pubkey: nostrPubkey,
                      },
                    });
                    router.back();
                  }
                },
                condition: !!(isPaid && currentTransaction?.metadata?.nostr),
              },
              {
                text: 'Cancel',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => handleCancel(),
                condition: !isPaid && !hasTransaction,
              },
              {
                text: isMelting ? 'Sending...' : 'Send',
                icon: isMelting ? 'ri:loader-line' : 'ri:send-plane-2-fill',
                variant: 'primary',
                onPress: async () => handleMelt(),
                condition: !isPaid && !hasTransaction,
                disabled: isMelting,
              },
              ...extraButtons.map((button) => ({
                ...button,
                condition: !isPaid && !hasTransaction,
              })),
            ]}
          />
        </HStack>
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={displayTransaction} />

        {!hasTransaction && (
          <MintBalanceDisplay
            onMintSelected={handleMintSelected}
            unit={unit}
            updateSelectedMint={false}
          />
        )}

        {getLightningDescription(
          'paymentRequest' in meltHistoryEntry
            ? (meltHistoryEntry as any).paymentRequest
            : undefined
        ) && (
          <Card
            message={getLightningDescription(
              'paymentRequest' in meltHistoryEntry
                ? (meltHistoryEntry as any).paymentRequest
                : undefined
            )}
            variant="info"
          />
        )}

        {currentTransaction?.metadata?.memo && (
          <Card message={currentTransaction.metadata.memo} variant="info" />
        )}

        {meltError && <Card message={`Payment failed: ${meltError.message}`} variant="warning" />}

        {hasTransaction && isPaid && (
          <TransactionMintRefresh
            mintInfo={mintInfo}
            historyEntry={currentTransaction}
            handleCheckStatus={async () => {}}
          />
        )}

        {hasTransaction && <MintQuoteTimeline historyEntry={currentTransaction} />}

        <Section
          items={[
            {
              title: 'Date',
              value: getLightningTimestamp(
                'paymentRequest' in meltHistoryEntry ? (meltHistoryEntry as any).paymentRequest : ''
              ),
            },
            { title: 'Type', value: 'Send • Lightning' },
            {
              title: 'Request',
              value: truncateMiddle(
                ('lud16' in meltHistoryEntry ? (meltHistoryEntry as any).lud16 : undefined) ||
                  ('paymentRequest' in meltHistoryEntry
                    ? (meltHistoryEntry as any).paymentRequest
                    : ''),
                ('lud16' in meltHistoryEntry ? (meltHistoryEntry as any).lud16 : undefined) ? 10 : 5
              ),
            },
            { title: 'Quote', value: truncateMiddle(quoteId, 7) },
            {
              title: `Fee (${getCurrencyDisplay()})`,
              value: formatAmount({ amount: feeReserve, unit }),
            },
            {
              title: 'Amount',
              value: `${displayTransaction.amount} ${unit.toUpperCase()}`,
            },
          ]}
        />

        {hasTransaction && <TransactionDebugCode historyEntry={currentTransaction} />}
      </VStack>
    </Modal>
  );
}

function ModalScreen() {
  const { meltHistoryEntry: meltHistoryEntryString } = useLocalSearchParams<{
    meltHistoryEntry: string;
  }>();

  const meltHistoryEntry = JSON.parse(meltHistoryEntryString) as MeltHistoryEntry;

  return <LightningSendConfirmation meltHistoryEntry={meltHistoryEntry} />;
}

export default withSheetProvider(ModalScreen);
