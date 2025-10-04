import React, { useState, useEffect } from 'react';
import { formatAmount } from 'helper/currency';
import { useCashuUtilities, useMintManagement } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { useSelector } from 'react-redux';
import { VStack, HStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import { handleBarcode } from 'helper/payment-handler/handlers';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { truncateMiddle } from 'helper/strings';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { Card } from 'components/ui/Card';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { SheetManager } from 'react-native-actions-sheet';
import { usePaginatedHistory } from 'coco-cashu-react';
import type { MeltHistoryEntry } from 'coco-cashu-core';
import { MintQuoteTimeline } from './lightningReceiveConfirmation';

export function LightningSendConfirmation({
  pr,
  unit: initialUnit,
  pubkey,
  meltQuote: initialMeltQuote,
  redirect,
  email,
  extraButtons = [],
  lud16,
}: {
  pr: string;
  unit: string;
  pubkey?: string;
  meltQuote?: string;
  redirect?: string;
  email?: string;
  extraButtons?: ButtonHandlerButton[];
  lud16?: string;
}) {
  const { getLightningDescription, getLightningTimestamp } = useCashuUtilities();
  const { history } = usePaginatedHistory();

  const [meltQuote, setMeltQuote] = useState(initialMeltQuote);
  const [unit, setUnit] = useState(initialUnit);
  const parsedQuote = JSON.parse(meltQuote || '{}');
  const amount = parsedQuote?.amount;
  const feeReserve = parsedQuote?.fee_reserve;
  const quoteId = parsedQuote?.quote;

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);
  const { getMintInfo } = useMintManagement();
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

  const handleOpenSheet = () => {
    SheetManager.show('lightning-mpp', {
      payload: {
        pr,
        unit,
        amount,
        pubkey,
        email,
        lud16,
        redirect,
      },
    });
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
                text: 'Send',
                icon: 'ri:send-plane-2-fill',
                variant: 'primary',
                onPress: async () => handleOpenSheet(),
                condition: !isPaid && !hasTransaction,
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

        {getLightningDescription(pr) && (
          <Card message={getLightningDescription(pr)} variant="info" />
        )}

        {currentTransaction?.metadata?.memo && (
          <Card message={currentTransaction.metadata.memo} variant="info" />
        )}

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
            { title: 'Date', value: getLightningTimestamp(pr) },
            { title: 'Type', value: 'Send • Lightning' },
            { title: 'Request', value: truncateMiddle(lud16 || pr, lud16 ? 10 : 5) },
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
  const { pr, unit, pubkey, meltQuote, redirect } = useLocalSearchParams<{
    pr: string;
    unit: string;
    pubkey?: string;
    meltQuote?: string;
    redirect?: string;
  }>();

  return (
    <LightningSendConfirmation
      pr={pr}
      unit={unit}
      pubkey={pubkey}
      meltQuote={meltQuote}
      redirect={redirect}
    />
  );
}

export default withSheetProvider(ModalScreen);
