/**
 * @fileoverview Transactions Modal Screen - Transaction history with filtering
 *
 * @module app/transactions
 *
 * @description
 * Modal screen for viewing and filtering transaction history. Users can filter by
 * payment type (Lightning/eCash), direction (incoming/outgoing), and status tabs.
 * Features smart mapping from UI selections to coco transaction types.
 *
 * **Features:**
 * - Payment type filtering (Lightning: mint/melt, eCash: send/receive)
 * - Direction filtering (incoming/outgoing)
 * - Status tabs (All, Confirmed, Pending, Expired)
 * - Currency selection
 * - Smart coco type mapping
 *
 * **Usage:**
 * ```typescript
 * router.push({
 *    pathname: '/transactions',
 *    params: {
 *      account: { unit: 'sat' },
 *      tab: 'Confirmed',
 *    },
 *  })
 * ```
 *
 * @see {@link components/blocks/Transactions}
 * @see {@link coco-cashu-core}
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, HStack } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import { useLocalSearchParams } from 'expo-router';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Transactions } from 'components/blocks/Transactions';
import Container from 'components/blocks/Container';
import CurrencySelector from 'components/blocks/CurrencySelector';
import Icon from 'assets/icons';
import { Tabs } from 'components/ui/Tabs';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { HistoryEntry, MintHistoryEntry } from 'coco-cashu-core';
import { mintHistoryEntryExpired } from 'helper/utils';
import { usePaginatedHistory } from 'coco-cashu-react';

/**
 * Transaction status tab type
 *
 * @typedef {'All' | 'Confirmed' | 'Pending' | 'Expired'} StatusTab
 */
type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';

/**
 * Payment type filter options
 *
 * @typedef {'all' | 'lightning' | 'ecash'} PaymentType
 */
type PaymentType = 'all' | 'lightning' | 'ecash';

/**
 * Direction filter options
 *
 * @typedef {'all' | 'incoming' | 'outgoing'} Direction
 */
type Direction = 'all' | 'incoming' | 'outgoing';

/**
 * Transactions Modal Screen - Transaction history with filtering
 *
 * @component
 * @param {Object} props - Component props (none required)
 * @returns {JSX.Element} The transactions modal screen
 *
 * @example
 * <ModalScreen />
 */
function ModalScreen() {
  const { getPrimaryColor } = useTheme();
  const { account, tab: tab_ } = useLocalSearchParams<{
    account: string;
    tab: 'All' | 'Incoming' | 'Outgoing';
  }>();

  // State management
  const [selectedCurrency, setSelectedCurrency] = useState(
    account ? JSON.parse(account).unit : 'sat'
  );
  const [paymentType, setPaymentType] = useState<PaymentType>('all');
  const [direction, setDirection] = useState<Direction>('all');
  const [tab, setTab] = useState<StatusTab>((tab_ as StatusTab) || 'All');

  /**
   * Handles currency selection change
   *
   * @description Updates the selected currency and normalizes to lowercase
   *
   * @param {string} currency - The new currency selection
   * @returns {void}
   */
  const handleCurrencyChange = useCallback((currency: string) => {
    setSelectedCurrency(currency.toLowerCase());
  }, []);

  /**
   * Toggles payment type filter (Lightning/eCash)
   *
   * @description Toggles between the selected payment type and 'all'. If the same
   * type is selected again, it resets to 'all'.
   *
   * @param {'lightning' | 'ecash'} type - The payment type to toggle
   * @returns {void}
   */
  const togglePaymentType = useCallback((type: 'lightning' | 'ecash') => {
    setPaymentType((prevType) => (prevType === type ? 'all' : type));
  }, []);

  /**
   * Toggles direction filter (incoming/outgoing)
   *
   * @description Toggles between the selected direction and 'all'. If the same
   * direction is selected again, it resets to 'all'.
   *
   * @param {'incoming' | 'outgoing'} dir - The direction to toggle
   * @returns {void}
   */
  const toggleDirection = useCallback((dir: 'incoming' | 'outgoing') => {
    setDirection((prevDir) => (prevDir === dir ? 'all' : dir));
  }, []);

  /**
   * Maps UI filter selections to coco transaction types
   *
   * @description Intelligently maps payment type and direction selections to the
   * corresponding coco transaction types. Lightning maps to mint/melt, eCash maps
   * to send/receive, and direction filters further narrow the selection.
   *
   * **Mapping Logic:**
   * - Lightning + All → ['mint', 'melt']
   * - Lightning + Incoming → ['mint']
   * - Lightning + Outgoing → ['melt']
   * - eCash + All → ['send', 'receive']
   * - eCash + Incoming → ['receive']
   * - eCash + Outgoing → ['send']
   * - All + Incoming → ['mint', 'receive']
   * - All + Outgoing → ['melt', 'send']
   * - All + All → ['mint', 'melt', 'send', 'receive']
   *
   * @returns {CocoTransactionType[]} Array of coco transaction types to filter by
   *
   * @example
   * // Lightning + Incoming selection
   * const types = getCocoTransactionTypes(); // ['mint']
   */
  const getCocoTransactionTypes = useCallback((): HistoryEntry['type'][] => {
    // All combinations
    if (paymentType === 'all' && direction === 'all') {
      return ['mint', 'melt', 'send', 'receive'];
    }

    // Lightning payments
    if (paymentType === 'lightning') {
      if (direction === 'all') return ['mint', 'melt'];
      if (direction === 'incoming') return ['mint'];
      if (direction === 'outgoing') return ['melt'];
    }

    // eCash payments
    if (paymentType === 'ecash') {
      if (direction === 'all') return ['send', 'receive'];
      if (direction === 'incoming') return ['receive'];
      if (direction === 'outgoing') return ['send'];
    }

    // Direction-only filtering
    if (paymentType === 'all') {
      if (direction === 'incoming') return ['mint', 'receive'];
      if (direction === 'outgoing') return ['melt', 'send'];
    }

    return [];
  }, [paymentType, direction]);

  const { history } = usePaginatedHistory();

  /**
   * Generates a unique key for the transaction list based on current filters
   *
   * @description Creates a cache key that changes when any filter changes,
   * ensuring proper re-rendering of the transaction list.
   *
   * @returns {string} Unique key combining all filter states
   */
  const listKey = `${paymentType}-${direction}-${tab}-${selectedCurrency}`;

  /**
   * Filters transaction history based on current selections
   *
   * @description Applies currency and transaction type filtering to the history.
   * Uses the smart mapping function to determine which transaction types to include.
   *
   * **Process:** currency filter → type filter → return filtered array
   * **Effects:** Updates when currency, payment type, or direction changes
   *
   * @returns {HistoryEntry[]} Filtered array of transaction history entries
   */
  const filteredHistory = useMemo(() => {
    const allowedTypes = getCocoTransactionTypes();

    return history.filter((historyEntry) => {
      // Filter by currency
      if (historyEntry.unit !== selectedCurrency) return false;

      // Filter by transaction type if types are specified
      if (allowedTypes.length > 0 && !allowedTypes.includes(historyEntry.type)) return false;

      return true;
    });
  }, [history, selectedCurrency, getCocoTransactionTypes]);

  /**
   * Calculates transaction counts by status (pending, confirmed, expired)
   *
   * @description Analyzes filtered transaction history to count entries by their
   * current status. Handles complex logic for mint/melt transactions with unpaid
   * states and expiration checking.
   *
   * **Status Logic:**
   * - **Expired:** Unpaid mint transactions that have passed their expiry time
   * - **Pending:** Unpaid mint/melt transactions that haven't expired
   * - **Confirmed:** All other transactions (paid or expired unpaid)
   *
   * **Process:** filter expired → filter pending → filter confirmed → return counts
   * **Effects:** Updates when filtered history changes
   *
   * @returns {Object} Object containing counts for each status
   * @returns {number} returns.pendingCount - Number of pending transactions
   * @returns {number} returns.confirmedCount - Number of confirmed transactions
   * @returns {number} returns.expiredCount - Number of expired transactions
   */
  const { pendingCount, confirmedCount, expiredCount } = useMemo(() => {
    // Helper function to check if a mint transaction is expired
    const isMintExpired = (entry: HistoryEntry): boolean => {
      return (
        entry.type === 'mint' &&
        entry.state === 'UNPAID' &&
        mintHistoryEntryExpired(entry as MintHistoryEntry)
      );
    };

    // Helper function to check if a transaction is pending (unpaid but not expired)
    const isPending = (entry: HistoryEntry): boolean => {
      const isUnpaid =
        (entry.type === 'mint' && entry.state === 'UNPAID') ||
        (entry.type === 'melt' && entry.state === 'UNPAID');

      return isUnpaid && !isMintExpired(entry);
    };

    // Count transactions by status
    const expired = filteredHistory.filter(isMintExpired);
    const pending = filteredHistory.filter(isPending);
    const confirmed = filteredHistory.filter((entry) => !isPending(entry) && !isMintExpired(entry));

    return {
      pendingCount: pending.length,
      confirmedCount: confirmed.length,
      expiredCount: expired.length,
    };
  }, [filteredHistory]);

  // Derived values
  const allCount = filteredHistory.length;
  const parsedAccount = account ? JSON.parse(account) : { unit: selectedCurrency };

  /**
   * Renders a filter button with consistent styling
   *
   * @description Creates a toggleable filter button with active/inactive states
   * and appropriate icons and colors.
   *
   * @param {Object} props - Button configuration
   * @param {string} props.type - The filter type ('lightning' | 'ecash' | 'incoming' | 'outgoing')
   * @param {string} props.icon - The icon name to display
   * @param {Function} props.onPress - Press handler function
   * @param {boolean} props.isActive - Whether the button is currently active
   * @param {string} props.className - Additional CSS classes
   * @returns {JSX.Element} The filter button component
   */
  const renderFilterButton = useCallback(
    ({
      icon,
      onPress,
      isActive,
      className = '',
    }: {
      icon: string;
      onPress: () => void;
      isActive: boolean;
      className?: string;
    }) => (
      <TouchableOpacity
        onPress={onPress}
        className={`${className} flex-1 rounded-lg border p-2 ${
          isActive ? 'bg-primary-700' : 'bg-primary-950'
        } border-primary-700`}>
        <HStack align="center" justify="center">
          <Icon
            name={icon}
            size={24}
            color={isActive ? getPrimaryColor('0') : getPrimaryColor('500')}
          />
        </HStack>
      </TouchableOpacity>
    ),
    [getPrimaryColor]
  );

  return (
    <Container>
      <View className="flex-1 p-4">
        <Transactions
          listKey={listKey}
          account={{ ...parsedAccount, unit: selectedCurrency }}
          showMore={false}
          history={history}
          filter={direction}
          type={paymentType}
          at="all"
          tab={tab}
          header={
            <>
              {/* Status tabs */}
              <Tabs
                tabs={['All', 'Confirmed', 'Pending', 'Expired']}
                selectedTab={tab}
                handleTabPress={(tab) => setTab(tab as StatusTab)}
                amounts={[
                  String(allCount),
                  String(confirmedCount),
                  String(pendingCount),
                  String(expiredCount),
                ]}
              />

              {/* Spacer */}
              <View style={{ height: 4 }} />

              {/* Currency selector */}
              <CurrencySelector
                selectedCurrency={selectedCurrency.toUpperCase()}
                onCurrencyChange={handleCurrencyChange}
              />

              {/* Filter buttons */}
              <HStack justify="space-between" align="center" className="my-2 w-full">
                {/* Payment type filters */}
                {renderFilterButton({
                  icon: 'mingcute:lightning-fill',
                  onPress: () => togglePaymentType('lightning'),
                  isActive: paymentType === 'lightning',
                  className: 'mr-2',
                })}

                {renderFilterButton({
                  icon: 'majesticons:coins',
                  onPress: () => togglePaymentType('ecash'),
                  isActive: paymentType === 'ecash',
                  className: 'mr-2',
                })}

                {/* Separator */}
                <View
                  className="mr-2 h-4 w-px"
                  style={{ backgroundColor: getPrimaryColor('700') }}
                />

                {/* Direction filters */}
                {renderFilterButton({
                  icon: 'fluent:arrow-download-16-filled',
                  onPress: () => toggleDirection('incoming'),
                  isActive: direction === 'incoming',
                  className: 'mr-2',
                })}

                {renderFilterButton({
                  icon: 'fluent:arrow-upload-16-filled',
                  onPress: () => toggleDirection('outgoing'),
                  isActive: direction === 'outgoing',
                })}
              </HStack>
            </>
          }
        />
      </View>
    </Container>
  );
}

/**
 * Transactions Modal Screen with Sheet Provider
 *
 * @description Exports the ModalScreen component wrapped with the sheet provider
 * for modal functionality and state management.
 *
 * @see {@link withSheetProvider}
 */
export default withSheetProvider(ModalScreen);
