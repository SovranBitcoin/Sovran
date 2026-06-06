/**
 * Transaction filter selection UI: currency, payment type, direction, status, mint.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { router } from 'expo-router';
import { HistoryEntry } from '@cashu/coco-core';
import { useMints } from '@cashu/coco-react';
import { z } from 'zod';

import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Text } from '@/shared/ui/primitives/Text';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { extractDomain } from '@/shared/lib/url';
import { mintHistoryEntryExpired } from '@/shared/lib/utils';
import { useHistoryWithMelts } from '@/features/transactions/hooks/useHistoryWithMelts';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import opacity from 'hex-color-opacity';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import {
  isPendingTransaction,
  matchesTransactionFilters,
  type TransactionDirection,
  type TransactionPaymentType,
} from '@sovranbitcoin/colada';

type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';

const SUPPORTED_CURRENCIES = ['ALL', 'SAT', 'USD', 'EUR', 'GBP'];

const ParamsSchema = z.object({
  currency: z.string().max(16).optional(),
  paymentType: z.enum(['all', 'lightning', 'ecash', 'onchain']).optional(),
  direction: z.enum(['all', 'incoming', 'outgoing']).optional(),
  status: z.enum(['All', 'Confirmed', 'Pending', 'Expired']).optional(),
  mintUrl: z.string().max(2048).optional(),
});

interface ChipProps {
  label: string;
  icon?: string;
  isSelected: boolean;
  onPress: () => void;
}

const Chip: React.FC<ChipProps> = ({ label, icon, isSelected, onPress }) => {
  const foreground = useThemeColor('foreground');

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: isSelected ? opacity(foreground, 0.15) : opacity(foreground, 0.05),
          borderColor: isSelected ? opacity(foreground, 0.25) : opacity(foreground, 0.08),
        },
      ]}>
      {icon ? (
        <Icon name={icon} size={16} color={isSelected ? foreground : opacity(foreground, 0.4)} />
      ) : null}
      <Text
        size={14}
        style={{
          color: isSelected ? foreground : opacity(foreground, 0.4),
          fontFamily: 'OxygenBold',
        }}>
        {label}
      </Text>
    </Pressable>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const foreground = useThemeColor('foreground');

  return (
    <View style={styles.section}>
      <Text
        size={13}
        style={{
          color: opacity(foreground, 0.33),
          fontFamily: 'OxygenBold',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 12,
        }}>
        {title}
      </Text>
      <View style={styles.chipsRow}>{children}</View>
    </View>
  );
};

const MintSelectorChip: React.FC<{
  showIcon?: boolean;
  name: string;
  iconUrl?: string;
  isSelected: boolean;
  onPress: () => void;
}> = ({ showIcon = true, name, iconUrl, isSelected, onPress }) => {
  const foreground = useThemeColor('foreground');

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.mintChip,
        {
          backgroundColor: isSelected ? opacity(foreground, 0.15) : opacity(foreground, 0.05),
          borderColor: isSelected ? opacity(foreground, 0.25) : opacity(foreground, 0.08),
        },
      ]}>
      {showIcon ? <MintIcon iconUrl={iconUrl} size={22} name={name} alt={`${name} icon`} /> : null}
      <Text
        size={13}
        numberOfLines={1}
        style={{
          color: isSelected ? foreground : opacity(foreground, 0.7),
          fontFamily: 'OxygenBold',
          maxWidth: 140,
        }}>
        {name}
      </Text>
    </Pressable>
  );
};

export function FiltersScreen() {
  useLifecycleLogger('FiltersScreen');
  const foreground = useThemeColor('foreground');
  const { trustedMints } = useMints();
  const { history } = useHistoryWithMelts();
  const quoteIdToGroup = useSwapTransactionsStore((state) => state.quoteIdToGroup);
  const swapGroupsById = useSwapTransactionsStore((state) => state.groups);

  const params = useRouteParams(ParamsSchema, { where: 'filter-flow.filters' });

  const [currency, setCurrency] = useState<string>(params?.currency || 'sat');
  const [paymentType, setPaymentType] = useState<TransactionPaymentType>(
    params?.paymentType || 'all'
  );
  const [direction, setDirection] = useState<TransactionDirection>(params?.direction || 'all');
  const [status, setStatus] = useState<Status>(params?.status || 'All');
  const [mintUrl, setMintUrl] = useState<string>(params?.mintUrl || 'all');

  const mintOptions = useMemo(
    () => [
      { mintUrl: 'all', name: 'All Mints', icon_url: undefined as string | undefined },
      ...trustedMints.map((mint) => ({
        mintUrl: mint.mintUrl,
        name: mint.mintInfo?.name || extractDomain(mint.mintUrl) || 'Unknown',
        icon_url: mint.mintInfo?.icon_url,
      })),
    ],
    [trustedMints]
  );

  const handleApply = useCallback(() => {
    log.info('tx.filters.apply', { currency, paymentType, direction, status, mintUrl });
    router.dismissTo({
      pathname: '/transactions',
      params: {
        filterCurrency: currency.toLowerCase(),
        filterPaymentType: paymentType,
        filterDirection: direction,
        filterStatus: status,
        filterMintUrl: mintUrl,
      },
    });
  }, [currency, paymentType, direction, status, mintUrl]);

  const handleReset = useCallback(() => {
    log.info('tx.filters.reset');
    setCurrency('sat');
    setPaymentType('all');
    setDirection('all');
    setStatus('All');
    setMintUrl('all');
  }, []);

  const hasActiveFilters = useMemo(
    () =>
      currency.toLowerCase() !== 'sat' ||
      paymentType !== 'all' ||
      direction !== 'all' ||
      status !== 'All' ||
      mintUrl !== 'all',
    [currency, paymentType, direction, status, mintUrl]
  );

  const resultCount = useMemo(() => {
    const normalizedCurrency = currency.toLowerCase();

    const filteredTransactions = history.filter((historyEntry: HistoryEntry) => {
      if (normalizedCurrency !== 'all' && historyEntry.unit !== normalizedCurrency) return false;
      if (mintUrl !== 'all' && historyEntry.mintUrl !== mintUrl) return false;

      if (historyEntry.type === 'mint' || historyEntry.type === 'melt') {
        const quoteId = (historyEntry as any).quoteId as string | undefined;
        if (quoteId && quoteIdToGroup[quoteId]) return false;
      }

      if (!matchesTransactionFilters(historyEntry, { paymentType, direction })) return false;

      if (status === 'All') return true;

      const isPending = isPendingTransaction(historyEntry);
      const isExpired =
        historyEntry.type === 'mint' &&
        String(historyEntry.state) === 'UNPAID' &&
        mintHistoryEntryExpired(historyEntry);

      if (status === 'Expired') return isExpired;
      if (status === 'Pending') return isPending && !isExpired;
      if (status === 'Confirmed') return !isPending && !isExpired;
      return true;
    });

    const shouldIncludeSwapRows =
      paymentType === 'all' &&
      direction === 'all' &&
      mintUrl === 'all' &&
      status !== 'Pending' &&
      status !== 'Expired';

    const swapCount = shouldIncludeSwapRows
      ? Object.values(swapGroupsById).filter((group) => {
          if (normalizedCurrency !== 'all' && group.unit !== normalizedCurrency) return false;
          return true;
        }).length
      : 0;

    return filteredTransactions.length + swapCount;
  }, [currency, direction, history, mintUrl, paymentType, quoteIdToGroup, status, swapGroupsById]);

  return (
    <ScreenWrapper
      name="FiltersScreen"
      contentPadding={0}
      footer={
        <BottomButtons>
          <Pressable
            onPress={handleReset}
            disabled={!hasActiveFilters}
            style={[styles.resetButton, { opacity: hasActiveFilters ? 1 : 0 }]}>
            <Text size={14} style={{ color: opacity(foreground, 0.4), fontFamily: 'OxygenBold' }}>
              Reset
            </Text>
          </Pressable>
          <ButtonHandler
            buttons={[
              {
                text: `Apply Filters (${resultCount})`,
                variant: 'primary',
                onPress: async () => handleApply(),
              },
            ]}
          />
        </BottomButtons>
      }>
      <View style={styles.filterContent}>
        <Section title="Mint">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mintChipsRow}>
            {mintOptions.map((mint) => (
              <MintSelectorChip
                key={mint.mintUrl}
                showIcon={mint.mintUrl !== 'all'}
                name={mint.name}
                iconUrl={mint.icon_url}
                isSelected={mintUrl === mint.mintUrl}
                onPress={() => setMintUrl(mint.mintUrl)}
              />
            ))}
          </ScrollView>
        </Section>

        <Section title="Currency">
          {SUPPORTED_CURRENCIES.map((curr) => (
            <Chip
              key={curr}
              label={curr}
              isSelected={currency.toUpperCase() === curr}
              onPress={() => setCurrency(curr.toLowerCase())}
            />
          ))}
        </Section>

        <Section title="Type">
          <Chip
            label="All"
            icon="fluent:apps-16-filled"
            isSelected={paymentType === 'all'}
            onPress={() => setPaymentType('all')}
          />
          <Chip
            label="Lightning"
            icon="mingcute:lightning-fill"
            isSelected={paymentType === 'lightning'}
            onPress={() => setPaymentType('lightning')}
          />
          <Chip
            label="Ecash"
            icon="majesticons:coins"
            isSelected={paymentType === 'ecash'}
            onPress={() => setPaymentType('ecash')}
          />
          <Chip
            label="Onchain"
            icon="hugeicons:blockchain-01"
            isSelected={paymentType === 'onchain'}
            onPress={() => setPaymentType('onchain')}
          />
        </Section>

        <Section title="Direction">
          <Chip
            label="All"
            icon="fluent:arrow-swap-16-filled"
            isSelected={direction === 'all'}
            onPress={() => setDirection('all')}
          />
          <Chip
            label="In"
            icon="fluent:arrow-download-16-filled"
            isSelected={direction === 'incoming'}
            onPress={() => setDirection('incoming')}
          />
          <Chip
            label="Out"
            icon="fluent:arrow-upload-16-filled"
            isSelected={direction === 'outgoing'}
            onPress={() => setDirection('outgoing')}
          />
        </Section>

        <Section title="Status">
          <Chip
            label="All"
            icon="fluent:list-16-filled"
            isSelected={status === 'All'}
            onPress={() => setStatus('All')}
          />
          <Chip
            label="Confirmed"
            icon="fluent:checkmark-circle-16-filled"
            isSelected={status === 'Confirmed'}
            onPress={() => setStatus('Confirmed')}
          />
          <Chip
            label="Pending"
            icon="fluent:clock-16-filled"
            isSelected={status === 'Pending'}
            onPress={() => setStatus('Pending')}
          />
          <Chip
            label="Expired"
            icon="fluent:dismiss-circle-16-filled"
            isSelected={status === 'Expired'}
            onPress={() => setStatus('Expired')}
          />
        </Section>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  filterContent: { paddingHorizontal: 16 },
  section: { marginBottom: 24 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mintChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  mintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
});
