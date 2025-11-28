/**
 * @fileoverview Transactions flow entry screen
 *
 * Part of the (transactions-flow) modal group.
 * Clicking on a transaction navigates horizontally within the modal.
 * Uses custom CollapsingHeader for Revolut-style large/small title animation.
 * Includes filter button in header right that opens filter sheet.
 */

import React, { useCallback } from 'react';
import { Platform, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionsScreen } from 'components/screens/TransactionsScreen';
import { HistoryEntry, ReceiveHistoryEntry } from 'coco-cashu-core';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { useTransactionsFilter } from 'components/screens/TransactionsFilterContext';
import { Host, Button } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

function CloseButton() {
  const { getPrimaryColor } = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <Host matchContents={false} fixedSize={true} style={{ width: 44, height: 44 }}>
        <Button
          variant="plain"
          systemImage="xmark"
          onPress={() => router.back()}
          modifiers={[
            frame({ width: 44, height: 44, alignment: 'center' }),
            glassEffect({ shape: 'circle' }),
          ]}
        />
      </Host>
    );
  }

  return (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );
}

function FilterButton() {
  const { getPrimaryColor } = useTheme();
  const { openFilterSheet, hasActiveFilters, activeFilterCount } = useTransactionsFilter();

  if (Platform.OS === 'ios') {
    return (
      <>
        <Host matchContents={false} fixedSize={true} style={{ width: 44, height: 44 }}>
          <Button
            variant="plain"
            systemImage="line.3.horizontal.decrease"
            onPress={openFilterSheet}
            modifiers={[
              frame({ width: 44, height: 44, alignment: 'center' }),
              glassEffect({ shape: 'circle' }),
            ]}
          />
        </Host>
        {hasActiveFilters && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              backgroundColor: getPrimaryColor('500'),
              borderRadius: 10,
              minWidth: 16,
              height: 16,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text
              size={10}
              style={{
                color: getPrimaryColor('0'),
                fontFamily: 'OverpassBold',
              }}>
              {activeFilterCount}
            </Text>
          </View>
        )}
      </>
    );
  }

  return (
    <TouchableOpacity onPress={openFilterSheet} style={{ padding: 8, position: 'relative' }}>
      <Icon
        name="fluent:filter-16-filled"
        size={22}
        color={hasActiveFilters ? getPrimaryColor('400') : getPrimaryColor('0')}
      />
      {hasActiveFilters && (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            backgroundColor: getPrimaryColor('500'),
            borderRadius: 10,
            minWidth: 16,
            height: 16,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text
            size={10}
            style={{
              color: getPrimaryColor('0'),
              fontFamily: 'OverpassBold',
            }}>
            {activeFilterCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function ModalScreen() {
  const { account, filterCurrency, filterPaymentType, filterDirection, filterStatus } =
    useLocalSearchParams<{
      account: string;
      filterCurrency?: string;
      filterPaymentType?: string;
      filterDirection?: string;
      filterStatus?: string;
    }>();
  const { getPrimaryColor } = useTheme();
  const {
    currency,
    paymentType,
    direction,
    status,
    selectedMonth,
    setSelectedMonth,
    setCurrency,
    setPaymentType,
    setDirection,
    setStatus,
  } = useTransactionsFilter();

  // Sync filter params from URL to context (when returning from filter flow)
  React.useEffect(() => {
    if (filterCurrency) setCurrency(filterCurrency);
    if (filterPaymentType) setPaymentType(filterPaymentType as 'all' | 'lightning' | 'ecash');
    if (filterDirection) setDirection(filterDirection as 'all' | 'incoming' | 'outgoing');
    if (filterStatus) setStatus(filterStatus as 'All' | 'Confirmed' | 'Pending' | 'Expired');
  }, [
    filterCurrency,
    filterPaymentType,
    filterDirection,
    filterStatus,
    setCurrency,
    setPaymentType,
    setDirection,
    setStatus,
  ]);

  const initialAccount = account ? JSON.parse(account) : undefined;

  // Handle transaction press - navigate within the transactions flow
  const handleTransactionPress = useCallback((historyEntry: HistoryEntry) => {
    switch (historyEntry.type) {
      case 'mint': {
        router.navigate({
          pathname: '/(transactions-flow)/mintQuote',
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        router.navigate({
          pathname: '/(transactions-flow)/meltQuote',
          params: {
            meltHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'send': {
        router.navigate({
          pathname: '/(transactions-flow)/sendToken',
          params: {
            sendHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'receive': {
        const receiveEntry = historyEntry as ReceiveHistoryEntry & { token?: string };
        router.navigate({
          pathname: '/(transactions-flow)/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(receiveEntry),
          },
        });
        return;
      }
    }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <TransactionsScreen
        initialAccount={initialAccount}
        initialTab={status}
        onTransactionPress={handleTransactionPress}
        // Pass filter state from context
        filterCurrency={currency}
        filterPaymentType={paymentType}
        filterDirection={direction}
        filterMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        // Header components for custom CollapsingHeader
        headerLeft={<CloseButton />}
        headerRight={<FilterButton />}
      />
    </View>
  );
}

export default withSheetProvider(ModalScreen);
