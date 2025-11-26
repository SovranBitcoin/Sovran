/**
 * @fileoverview Shared Transactions screen component
 *
 * This module provides the core UI and logic for the transactions list.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, HStack } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Transactions } from 'components/blocks/Transactions';
import Container from 'components/blocks/Container';
import CurrencySelector from 'components/blocks/CurrencySelector';
import Icon from 'assets/icons';
import { Tabs } from 'components/ui/Tabs';
import { HistoryEntry, MintHistoryEntry } from 'coco-cashu-core';
import { mintHistoryEntryExpired } from 'helper/utils';
import { usePaginatedHistory } from 'coco-cashu-react';

type StatusTab = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';

export interface TransactionsScreenProps {
  initialAccount?: { unit: string };
  initialTab?: StatusTab;
  /** Called when a transaction is tapped - used for flow-aware navigation */
  onTransactionPress?: (historyEntry: HistoryEntry) => void;
}

export function TransactionsScreen({
  initialAccount,
  initialTab = 'All',
  onTransactionPress,
}: TransactionsScreenProps) {
  const { getPrimaryColor } = useTheme();

  // State management
  const [selectedCurrency, setSelectedCurrency] = useState(initialAccount?.unit || 'sat');
  const [paymentType, setPaymentType] = useState<PaymentType>('all');
  const [direction, setDirection] = useState<Direction>('all');
  const [tab, setTab] = useState<StatusTab>(initialTab);

  const handleCurrencyChange = useCallback((currency: string) => {
    setSelectedCurrency(currency.toLowerCase());
  }, []);

  const togglePaymentType = useCallback((type: 'lightning' | 'ecash') => {
    setPaymentType((prevType) => (prevType === type ? 'all' : type));
  }, []);

  const toggleDirection = useCallback((dir: 'incoming' | 'outgoing') => {
    setDirection((prevDir) => (prevDir === dir ? 'all' : dir));
  }, []);

  const getCocoTransactionTypes = useCallback((): HistoryEntry['type'][] => {
    if (paymentType === 'all' && direction === 'all') {
      return ['mint', 'melt', 'send', 'receive'];
    }

    if (paymentType === 'lightning') {
      if (direction === 'all') return ['mint', 'melt'];
      if (direction === 'incoming') return ['mint'];
      if (direction === 'outgoing') return ['melt'];
    }

    if (paymentType === 'ecash') {
      if (direction === 'all') return ['send', 'receive'];
      if (direction === 'incoming') return ['receive'];
      if (direction === 'outgoing') return ['send'];
    }

    if (paymentType === 'all') {
      if (direction === 'incoming') return ['mint', 'receive'];
      if (direction === 'outgoing') return ['melt', 'send'];
    }

    return [];
  }, [paymentType, direction]);

  const { history, isFetching } = usePaginatedHistory();

  const listKey = `${paymentType}-${direction}-${tab}-${selectedCurrency}`;

  const filteredHistory = useMemo(() => {
    const allowedTypes = getCocoTransactionTypes();

    return history.filter((historyEntry) => {
      if (historyEntry.unit !== selectedCurrency) return false;
      if (allowedTypes.length > 0 && !allowedTypes.includes(historyEntry.type)) return false;
      return true;
    });
  }, [history, selectedCurrency, getCocoTransactionTypes]);

  const { pendingCount, confirmedCount, expiredCount } = useMemo(() => {
    const isMintExpired = (entry: HistoryEntry): boolean => {
      return (
        entry.type === 'mint' &&
        entry.state === 'UNPAID' &&
        mintHistoryEntryExpired(entry as MintHistoryEntry)
      );
    };

    const isPending = (entry: HistoryEntry): boolean => {
      const isUnpaid =
        (entry.type === 'mint' && entry.state === 'UNPAID') ||
        (entry.type === 'melt' && entry.state === 'UNPAID');

      return isUnpaid && !isMintExpired(entry);
    };

    const expired = filteredHistory.filter(isMintExpired);
    const pending = filteredHistory.filter(isPending);
    const confirmed = filteredHistory.filter((entry) => !isPending(entry) && !isMintExpired(entry));

    return {
      pendingCount: pending.length,
      confirmedCount: confirmed.length,
      expiredCount: expired.length,
    };
  }, [filteredHistory]);

  const allCount = filteredHistory.length;
  const parsedAccount = { unit: selectedCurrency };

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
          isFetching={isFetching}
          filter={direction}
          type={paymentType}
          at="all"
          tab={tab}
          onTransactionPress={onTransactionPress}
          header={
            <>
              {/* Status tabs */}
              <Tabs
                tabs={['All', 'Confirmed', 'Pending', 'Expired']}
                selectedTab={tab}
                handleTabPress={(t) => setTab(t as StatusTab)}
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

