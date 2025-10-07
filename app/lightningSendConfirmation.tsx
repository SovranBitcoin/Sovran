import React, { useState, useEffect } from 'react';
import { formatAmount } from 'helper/currency';
import { useMintManagement, useMelt, useManager } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { VStack, HStack } from 'components/ui/View';
import { useLocalSearchParams, router } from 'expo-router';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { truncateMiddle } from 'helper/strings';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from '@/redux/cashu';
import { Alert } from 'react-native';
import { MintQuoteTimeline } from '@/components/blocks/Transaction/TransactionTimeline';
import { HistoryEntry } from 'coco-cashu-core';
import { getLightningTimestamp } from '@/helper/coco/utils';

export function LightningSendConfirmation({ meltQuote }: { meltQuote: MeltQuoteResponse }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const { payMeltQuote, currentQuote, createMeltQuote, isCreatingQuote } = useMelt();
  const { getMintInfo } = useMintManagement();

  const [mintInfo, setMintInfo] = useState<any>({});

  const displayQuote = currentQuote || meltQuote;
  const manager = useManager();
  useEffect(() => {
    manager.history.getPaginatedHistory().then(setHistory);
  }, [manager, displayQuote]);
  const [unit, setUnit] = useState(meltQuote.unit);
  const amount = displayQuote.amount;
  const feeReserve = displayQuote.fee_reserve;
  const quoteId = displayQuote.quote;

  // Load mint info
  useEffect(() => {
    const loadMintInfo = async () => {
      if (selectedMint) {
        try {
          const info = await getMintInfo(selectedMint);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      }
    };
    loadMintInfo();
  }, [selectedMint, getMintInfo]);

  const handleMintSelected = async (mint: any) => {
    try {
      await createMeltQuote(mint.id, meltQuote.request);
      setUnit(mint.unit.toLowerCase());
    } catch (error) {
      console.error('Failed to create quote with new mint:', error);
      Alert.alert('Error', 'Failed to create quote with selected mint');
    }
  };

  const handleMelt = async () => {
    if (!selectedMint) {
      throw new Error('No mint selected');
    }

    await payMeltQuote(selectedMint, displayQuote.quote);
  };

  const handleCancel = () => {
    router.dismissAll();
    router.push('/(drawer)/(tabs)');
  };

  // Create a synthetic history entry for display
  const displayMeltHistoryEntry = history.find(
    (h) => h.type === 'melt' && h.quoteId === displayQuote?.quote
  );

  if (!displayMeltHistoryEntry || isCreatingQuote) {
    return null;
  }

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
                condition: displayQuote.state === 'PAID',
              },
              {
                text: 'Cancel',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => handleCancel(),
                condition: displayQuote.state === 'UNPAID',
              },
              {
                text: isCreatingQuote ? 'Sending...' : 'Send',
                icon: isCreatingQuote ? 'ri:loader-line' : 'ri:send-plane-2-fill',
                variant: 'primary',
                onPress: async () => handleMelt(),
                condition: displayQuote.state === 'UNPAID',
                disabled: isCreatingQuote,
              },
            ]}
          />
        </HStack>
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={displayMeltHistoryEntry} />

        {displayQuote.state === 'UNPAID' ? (
          <MintBalanceDisplay onMintSelected={handleMintSelected} unit={unit} updateSelectedMint />
        ) : (
          <TransactionMintRefresh
            mintInfo={mintInfo}
            historyEntry={displayMeltHistoryEntry}
            handleCheckStatus={async () => {}}
          />
        )}

        <MintQuoteTimeline historyEntry={displayMeltHistoryEntry} />

        <Section
          items={[
            {
              title: 'Date',
              value: getLightningTimestamp(meltQuote.request),
            },
            { title: 'Type', value: 'Send • Lightning' },
            {
              title: 'Request',
              value: truncateMiddle(meltQuote.request, 5),
            },
            { title: 'Quote', value: truncateMiddle(quoteId, 7) },
            {
              title: `Fee`,
              value: formatAmount({ amount: feeReserve, unit }),
            },
            {
              title: 'Amount',
              value: `${amount} ${unit.toUpperCase()}`,
            },
            {
              title: 'State',
              value: displayQuote.state,
            },
          ]}
        />
      </VStack>
    </Modal>
  );
}

function ModalScreen() {
  const { meltQuote: meltQuoteString } = useLocalSearchParams<{
    meltQuote: string;
  }>();

  const meltQuote = JSON.parse(meltQuoteString || '{}') as MeltQuoteResponse;

  return <LightningSendConfirmation meltQuote={meltQuote} />;
}

export default withSheetProvider(ModalScreen);
