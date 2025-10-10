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
import { HistoryEntry, MeltHistoryEntry } from 'coco-cashu-core';
import { getLightningTimestamp } from '@/helper/coco/utils';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Spinner } from 'components/ui/Spinner';
import { convertTime } from '@/helper/time';

export function LightningSendConfirmation({
  meltQuote,
  meltHistoryEntry,
}: {
  meltQuote?: MeltQuoteResponse;
  meltHistoryEntry?: MeltHistoryEntry;
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const { payMeltQuote, currentQuote, createMeltQuote, isCreatingQuote, getMeltQuote } = useMelt();
  const { getMintInfo } = useMintManagement();
  const { getPrimaryColor } = useTheme();

  const [mintInfo, setMintInfo] = useState<any>({});
  const [fetchedMeltQuote, setFetchedMeltQuote] = useState<MeltQuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch melt quote if meltHistoryEntry is provided
  useEffect(() => {
    const fetchMeltQuote = async () => {
      if (meltHistoryEntry && !meltQuote) {
        setLoading(true);
        setError(null);

        try {
          if (!meltHistoryEntry.quoteId) {
            throw new Error('No quote ID found in melt history entry');
          }

          // Get mint info to get the mint URL
          const mintInfo = await getMintInfo(meltHistoryEntry.mintUrl);
          if (!mintInfo) {
            throw new Error('Mint not found');
          }

          // Fetch the melt quote using the quote ID
          const quote = await getMeltQuote(meltHistoryEntry.mintUrl, meltHistoryEntry.quoteId);

          if (!quote) {
            throw new Error('Melt quote not found');
          }

          setFetchedMeltQuote(quote);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to load melt quote';
          setError(errorMessage);
          console.error('Failed to fetch melt quote:', err);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchMeltQuote();
  }, [meltHistoryEntry, meltQuote, getMeltQuote, getMintInfo]);

  const displayQuote = currentQuote || meltQuote || fetchedMeltQuote;
  console.log('displayQuote', displayQuote);
  const manager = useManager();
  useEffect(() => {
    manager.history.getPaginatedHistory().then(setHistory);
  }, [manager, displayQuote]);
  const [unit, setUnit] = useState(meltQuote?.unit || meltHistoryEntry?.unit || 'sat');
  const amount = displayQuote?.amount || 0;
  const feeReserve = displayQuote?.fee_reserve || 0;
  const quoteId = displayQuote?.quote || '';

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
      await createMeltQuote(mint.id, meltQuote?.request || '');
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

    await payMeltQuote(selectedMint, displayQuote?.quote || '');
  };

  const handleCancel = () => {
    router.dismissAll();
    router.push('/(drawer)/(tabs)');
  };

  // Show loading state
  if (loading) {
    return (
      <Modal showClose title="Send Lightning">
        <VStack style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Spinner size={32} />
          <Text
            size={16}
            style={{
              color: getPrimaryColor('300'),
              marginTop: 16,
            }}>
            Loading melt quote...
          </Text>
        </VStack>
      </Modal>
    );
  }

  // Show error state
  if (error) {
    return (
      <Modal showClose title="Send Lightning">
        <VStack style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text
            size={18}
            bold
            style={{
              color: getPrimaryColor('0'),
              marginBottom: 16,
              textAlign: 'center',
            }}>
            Error Loading Melt Quote
          </Text>
          <Text
            size={14}
            style={{
              color: getPrimaryColor('300'),
              marginBottom: 24,
              textAlign: 'center',
            }}>
            {error}
          </Text>
          <Text
            size={14}
            style={{
              color: getPrimaryColor('400'),
              textAlign: 'center',
            }}
            onPress={() => router.back()}>
            Tap to go back
          </Text>
        </VStack>
      </Modal>
    );
  }

  // Show loading state if no quote is available yet
  if (!displayQuote) {
    return null;
  }

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

        <MintQuoteTimeline historyEntry={displayMeltHistoryEntry} meltQuote={displayQuote} />

        <Section
          items={[
            {
              title: 'Date',
              value: convertTime(getLightningTimestamp(displayQuote?.request || '') * 1000),
            },
            { title: 'Type', value: 'Send • Lightning' },
            {
              title: 'Request',
              value: truncateMiddle(displayQuote?.request || '', 5),
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
  const { meltQuote: meltQuoteString, meltHistoryEntry: meltHistoryEntryString } =
    useLocalSearchParams<{
      meltQuote?: string;
      meltHistoryEntry?: string;
    }>();

  const meltQuote = meltQuoteString
    ? (JSON.parse(meltQuoteString) as MeltQuoteResponse)
    : undefined;
  const meltHistoryEntry = meltHistoryEntryString
    ? (JSON.parse(meltHistoryEntryString) as MeltHistoryEntry)
    : undefined;

  return <LightningSendConfirmation meltQuote={meltQuote} meltHistoryEntry={meltHistoryEntry} />;
}

export default withSheetProvider(ModalScreen);
