/**
 * @fileoverview Shared MeltQuote screen component
 *
 * This module provides the core UI and logic for Lightning melt quotes (sending).
 * It is used by both standalone and flow-based route wrappers.
 *
 * The Screen component handles:
 * - Parsing meltQuote and meltHistoryEntry from string params
 * - Loading and error states
 * - All UI and business logic
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ScrollView, Alert } from 'react-native';
import { formatAmount } from 'helper/currency';
import { useMintManagement, useMelt, useManager } from 'hooks/coco';
import { VStack, HStack, View } from 'components/ui/View';
import { router } from 'expo-router';
import WalletHeaderTitle from 'components/blocks/WalletHeaderTitle';
import { truncateMiddle } from 'helper/strings';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { useMintStore } from '@/stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { HistoryEntry, MeltHistoryEntry } from 'coco-cashu-core';
import { getLightningTimestamp } from '@/helper/coco/utils';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Spinner } from 'components/ui/Spinner';
import { convertTime } from 'helper/time';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { meltQuoteExpired } from 'helper/utils';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface MeltQuoteScreenProps {
  /** Either the parsed quote or a JSON string to be parsed internally */
  meltQuote?: MeltQuoteResponse | string;
  /** Either the parsed entry or a JSON string to be parsed internally */
  meltHistoryEntry?: MeltHistoryEntry | string;
  onCancel: () => void;
}

export function MeltQuoteScreen({
  meltQuote: meltQuoteProp,
  meltHistoryEntry: meltHistoryEntryProp,
  onCancel,
}: MeltQuoteScreenProps) {
  // Parse props - handles both string (from params) and object
  const { meltQuote, meltHistoryEntry } = useMemo(() => {
    let parsedQuote: MeltQuoteResponse | undefined;
    let parsedHistoryEntry: MeltHistoryEntry | undefined;

    if (meltQuoteProp) {
      if (typeof meltQuoteProp === 'string') {
        try {
          parsedQuote = JSON.parse(meltQuoteProp) as MeltQuoteResponse;
        } catch {
          parsedQuote = undefined;
        }
      } else {
        parsedQuote = meltQuoteProp;
      }
    }

    if (meltHistoryEntryProp) {
      if (typeof meltHistoryEntryProp === 'string') {
        try {
          parsedHistoryEntry = JSON.parse(meltHistoryEntryProp) as MeltHistoryEntry;
        } catch {
          parsedHistoryEntry = undefined;
        }
      } else {
        parsedHistoryEntry = meltHistoryEntryProp;
      }
    }

    return { meltQuote: parsedQuote, meltHistoryEntry: parsedHistoryEntry };
  }, [meltQuoteProp, meltHistoryEntryProp]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const { payMeltQuote, currentQuote, createMeltQuote, isCreatingQuote, getMeltQuote } = useMelt();
  const { getMintInfo } = useMintManagement();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  const [mintInfo, setMintInfo] = useState<any>({});
  const [fetchedMeltQuote, setFetchedMeltQuote] = useState<MeltQuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMeltQuote = async () => {
      if (meltHistoryEntry && !meltQuote) {
        setLoading(true);
        setError(null);

        try {
          if (!meltHistoryEntry.quoteId) {
            throw new Error('No quote ID found in melt history entry');
          }

          const mintInfoResult = await getMintInfo(meltHistoryEntry.mintUrl);
          if (!mintInfoResult) {
            throw new Error('Mint not found');
          }

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
  const manager = useManager();

  useEffect(() => {
    manager.history.getPaginatedHistory().then(setHistory);
  }, [manager, displayQuote]);

  // Subscribe to history:updated events to refresh when melt quote state changes
  useEffect(() => {
    const handler = () => {
      manager.history.getPaginatedHistory().then(setHistory);
    };
    manager.on('history:updated', handler);
    return () => {
      manager.off('history:updated', handler);
    };
  }, [manager]);

  const [unit, setUnit] = useState(meltQuote?.unit || meltHistoryEntry?.unit || 'sat');
  const amount = displayQuote?.amount || 0;
  const feeReserve = displayQuote?.fee_reserve || 0;
  const quoteId = displayQuote?.quote || '';

  useEffect(() => {
    const loadMintInfo = async () => {
      if (selectedMint) {
        try {
          const info = await getMintInfo(selectedMint);
          setMintInfo(info);
        } catch (err) {
          console.error('Failed to load mint info:', err);
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
    } catch (err) {
      console.error('Failed to create quote with new mint:', err);
      Alert.alert('Error', 'Failed to create quote with selected mint');
    }
  };

  const handleMelt = async () => {
    if (!selectedMint) {
      throw new Error('No mint selected');
    }

    await payMeltQuote(selectedMint, displayQuote?.quote || '');
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
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
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
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
      </View>
    );
  }

  if (!displayQuote) {
    return null;
  }

  const displayMeltHistoryEntry = history.find(
    (h): h is MeltHistoryEntry => h.type === 'melt' && h.quoteId === displayQuote?.quote
  );

  if (!displayMeltHistoryEntry || isCreatingQuote) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: 120,
        }}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={displayMeltHistoryEntry} />

          {displayMeltHistoryEntry.state === 'UNPAID' && !meltQuoteExpired(displayQuote) ? (
            <WalletHeaderTitle width={280} unit={unit} onMintSelected={handleMintSelected} />
          ) : (
            <HistoryEntryRefresh
              mintInfo={mintInfo}
              historyEntry={displayMeltHistoryEntry}
              handleCheckStatus={async () => {}}
            />
          )}

          <HistoryEntryTimeline historyEntry={displayMeltHistoryEntry} meltQuote={displayQuote} />

          <Section
            items={[
              {
                title: 'Date',
                value: convertTime(
                  new Date(getLightningTimestamp(displayQuote?.request || '') * 1000)
                ),
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
                value: displayMeltHistoryEntry.state,
              },
            ]}
          />
        </VStack>
      </ScrollView>

      <BottomButtons>
        <HStack className="pb-2" justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Close',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => onCancel(),
                condition: displayMeltHistoryEntry.state === 'PAID',
              },
              {
                text: 'Cancel',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => onCancel(),
                condition:
                  displayMeltHistoryEntry.state === 'UNPAID' && !meltQuoteExpired(displayQuote),
              },
              {
                text: 'Close',
                icon: 'ri:close-circle-line',
                variant: 'secondary',
                onPress: async () => onCancel(),
                condition: meltQuoteExpired(displayQuote),
              },
              {
                text: isCreatingQuote ? 'Sending...' : 'Send',
                icon: isCreatingQuote ? 'ri:loader-line' : 'ri:send-plane-2-fill',
                variant: 'primary',
                onPress: async () => handleMelt(),
                condition:
                  displayMeltHistoryEntry.state === 'UNPAID' && !meltQuoteExpired(displayQuote),
                disabled: isCreatingQuote,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}
