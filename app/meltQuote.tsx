/**
 * @fileoverview Lightning payment melt quote interface for the Sovran wallet
 *
 * This module provides the user interface for melting ecash tokens to send Lightning payments.
 * It handles melt quote creation, payment processing, and displays comprehensive transaction
 * details with real-time status updates and mint management.
 *
 * @example
 * // Navigation usage with melt quote
 * router.push({
 *   pathname: '/meltQuote',
 *   params: { meltQuote: JSON.stringify(quote) }
 * });
 *
 * // Navigation usage with melt history entry
 * router.push({
 *   pathname: '/meltQuote',
 *   params: { meltHistoryEntry: JSON.stringify(historyEntry) }
 * });
 *
 * // Component usage with a melt quote
 * <MeltQuote meltQuote={quote} />
 *
 * // With melt history entry for fetching quote
 * <MeltQuote meltHistoryEntry={historyEntry} />
 */

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
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from '@/redux/cashu';
import { Alert } from 'react-native';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { HistoryEntry, MeltHistoryEntry } from 'coco-cashu-core';
import { getLightningTimestamp } from '@/helper/coco/utils';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Spinner } from 'components/ui/Spinner';
import { convertTime } from 'helper/time';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';

/**
 * Props for the MeltQuote component
 */
interface MeltQuoteProps {
  /** Optional melt quote response for immediate display */
  meltQuote?: MeltQuoteResponse;
  /** Optional melt history entry for fetching quote data */
  meltHistoryEntry?: MeltHistoryEntry;
}

/**
 * Main component for melting ecash tokens to Lightning payments
 *
 * This component provides a complete interface for melting ecash tokens to send Lightning payments, including:
 * - Melt quote creation and management
 * - Lightning payment processing
 * - Real-time transaction status tracking
 * - Mint selection and balance management
 * - Comprehensive transaction details display
 * - Error handling and loading states
 *
 * The component can work with either a pre-existing melt quote or a melt history entry
 * that it will use to fetch the quote data from the mint.
 *
 * @param props - The component props
 * @returns JSX element representing the melt quote interface
 *
 * @example
 * // With existing melt quote
 * <MeltQuote meltQuote={quote} />
 *
 * // With history entry to fetch quote
 * <MeltQuote meltHistoryEntry={historyEntry} />
 */
export function MeltQuote({ meltQuote, meltHistoryEntry }: MeltQuoteProps) {
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

  /**
   * Handles mint selection for creating a new melt quote
   *
   * When a user selects a different mint, this function creates a new melt quote
   * with the selected mint and updates the unit display accordingly.
   *
   * @param mint - The selected mint object containing id and unit information
   * @async
   * @throws {Error} When melt quote creation fails
   */
  const handleMintSelected = async (mint: any) => {
    try {
      await createMeltQuote(mint.id, meltQuote?.request || '');
      setUnit(mint.unit.toLowerCase());
    } catch (error) {
      console.error('Failed to create quote with new mint:', error);
      Alert.alert('Error', 'Failed to create quote with selected mint');
    }
  };

  /**
   * Handles the melt payment process
   *
   * Processes the Lightning payment by paying the melt quote through the selected mint.
   * This function requires a selected mint and a valid quote ID to proceed.
   *
   * @async
   * @throws {Error} When no mint is selected or payment fails
   */
  const handleMelt = async () => {
    if (!selectedMint) {
      throw new Error('No mint selected');
    }

    await payMeltQuote(selectedMint, displayQuote?.quote || '');
  };

  /**
   * Handles the cancel action
   *
   * Dismisses all modals and navigates back to the main tabs screen.
   * This is used when the user wants to cancel the melt process.
   */
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
        <HistoryEntryHeader historyEntry={displayMeltHistoryEntry} />

        {displayQuote.state === 'UNPAID' ? (
          <MintBalanceDisplay onMintSelected={handleMintSelected} unit={unit} updateSelectedMint />
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
              value: displayQuote.state,
            },
          ]}
        />
      </VStack>
    </Modal>
  );
}

/**
 * Modal screen wrapper for the MeltQuote component
 *
 * This component handles the modal presentation of the melt quote interface.
 * It parses the melt quote and/or melt history entry from the URL parameters
 * and passes them to the main MeltQuote component.
 *
 * @returns JSX element representing the modal screen
 */
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

  return <MeltQuote meltQuote={meltQuote} meltHistoryEntry={meltHistoryEntry} />;
}

/**
 * Default export wrapped with sheet provider for modal functionality
 *
 * This export provides the modal screen with the necessary sheet provider
 * context for displaying action sheets and other modal components.
 */
export default withSheetProvider(ModalScreen);
