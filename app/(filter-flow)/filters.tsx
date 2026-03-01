/**
 * @fileoverview Filters Screen - Transaction filter selection UI
 *
 * Allows users to filter transactions by:
 * - Currency (SAT, USD, EUR, GBP)
 * - Payment type (All, Lightning, Ecash)
 * - Direction (All, Incoming, Outgoing)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { useThemeColor } from '@/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { ModalScreenLayout } from 'components/layouts/ModalScreenLayout';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useMints } from 'coco-cashu-react';
import { extractDomain } from 'helper/url';
import { useHistoryWithMelts } from 'hooks/coco/useHistoryWithMelts';
import { useSwapTransactionsStore } from 'stores/swapTransactionsStore';
import { mintHistoryEntryExpired } from 'helper/utils';
import { HistoryEntry, MintHistoryEntry } from 'coco-cashu-core';

type PaymentType = 'all' | 'lightning' | 'ecash';
type Direction = 'all' | 'incoming' | 'outgoing';
type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';

const SUPPORTED_CURRENCIES = ['ALL', 'SAT', 'USD', 'EUR', 'GBP'];

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
          fontFamily: 'OverpassSemibold',
        }}>
        {label}
      </Text>
    </Pressable>
  );
};

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => {
  const foreground = useThemeColor('foreground');

  return (
    <View style={styles.section}>
      <Text
        size={13}
        style={{
          color: opacity(foreground, 0.33),
          fontFamily: 'OverpassSemibold',
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

interface MintSelectorChipProps {
  showIcon?: boolean;
  name: string;
  iconUrl?: string;
  isSelected: boolean;
  onPress: () => void;
}

const MintSelectorChip: React.FC<MintSelectorChipProps> = ({
  showIcon = true,
  name,
  iconUrl,
  isSelected,
  onPress,
}) => {
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
      {showIcon ? (
        <Avatar picture={iconUrl} size={22} variant="mint" name={name} alt={`${name} icon`} />
      ) : null}
      <Text
        size={13}
        numberOfLines={1}
        style={{
          color: isSelected ? foreground : opacity(foreground, 0.7),
          fontFamily: 'OverpassSemibold',
          maxWidth: 140,
        }}>
        {name}
      </Text>
    </Pressable>
  );
};

export default function FiltersScreen() {
  const foreground = useThemeColor('foreground');
  const { trustedMints } = useMints();
  const { history } = useHistoryWithMelts();
  const quoteIdToGroup = useSwapTransactionsStore((state) => state.quoteIdToGroup);
  const swapGroupsById = useSwapTransactionsStore((state) => state.groups);

  // Get initial values from params
  const params = useLocalSearchParams<{
    currency?: string;
    paymentType?: string;
    direction?: string;
    status?: string;
    mintUrl?: string;
  }>();

  // State for filters
  const [currency, setCurrency] = useState<string>(params.currency || 'sat');
  const [paymentType, setPaymentType] = useState<PaymentType>(
    (params.paymentType as PaymentType) || 'all'
  );
  const [direction, setDirection] = useState<Direction>((params.direction as Direction) || 'all');
  const [status, setStatus] = useState<Status>((params.status as Status) || 'All');
  const [mintUrl, setMintUrl] = useState<string>(params.mintUrl || 'all');

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
    setCurrency('sat');
    setPaymentType('all');
    setDirection('all');
    setStatus('All');
    setMintUrl('all');
  }, []);

  const hasActiveFilters = useMemo(() => {
    return (
      currency.toLowerCase() !== 'sat' ||
      paymentType !== 'all' ||
      direction !== 'all' ||
      status !== 'All' ||
      mintUrl !== 'all'
    );
  }, [currency, paymentType, direction, status, mintUrl]);

  const resultCount = useMemo(() => {
    const normalizedCurrency = currency.toLowerCase();

    const filteredTransactions = history.filter((historyEntry: HistoryEntry) => {
      if (normalizedCurrency !== 'all' && historyEntry.unit !== normalizedCurrency) return false;
      if (mintUrl !== 'all' && historyEntry.mintUrl !== mintUrl) return false;

      // Hide transactions that are represented by a swap group row
      if (historyEntry.type === 'mint' || historyEntry.type === 'melt') {
        const quoteId = (historyEntry as any).quoteId as string | undefined;
        if (quoteId && quoteIdToGroup[quoteId]) return false;
      }

      if (
        direction === 'incoming' &&
        historyEntry.type !== 'mint' &&
        historyEntry.type !== 'receive'
      )
        return false;
      if (direction === 'outgoing' && historyEntry.type !== 'send' && historyEntry.type !== 'melt')
        return false;
      if (
        paymentType === 'lightning' &&
        historyEntry.type !== 'mint' &&
        historyEntry.type !== 'melt'
      )
        return false;
      if (
        paymentType === 'ecash' &&
        historyEntry.type !== 'send' &&
        historyEntry.type !== 'receive'
      )
        return false;

      if (status === 'All') return true;

      const isPending =
        (historyEntry.type === 'mint' && historyEntry.state === 'UNPAID') ||
        (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID') ||
        (historyEntry.type === 'send' &&
          (historyEntry.state === 'pending' || historyEntry.state === 'prepared'));
      const isExpired =
        historyEntry.type === 'mint' &&
        historyEntry.state === 'UNPAID' &&
        mintHistoryEntryExpired(historyEntry as MintHistoryEntry);

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
    <ModalScreenLayout
      bottomButtons={
        <View style={styles.bottomArea}>
          <ButtonHandler
            style={{ paddingBottom: 0 }}
            buttons={[
              {
                text: `Apply Filters (${resultCount})`,
                variant: 'primary',
                onPress: async () => handleApply(),
              },
            ]}
          />
          <Pressable
            onPress={handleReset}
            disabled={!hasActiveFilters}
            style={[styles.resetButton, { opacity: hasActiveFilters ? 1 : 0 }]}>
            <Text
              size={14}
              style={{ color: opacity(foreground, 0.4), fontFamily: 'OverpassMedium' }}>
              Reset
            </Text>
          </Pressable>
        </View>
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

        {/* Currency */}
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

        {/* Payment Type */}
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
        </Section>

        {/* Direction */}
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

        {/* Status */}
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
    </ModalScreenLayout>
  );
}

const styles = StyleSheet.create({
  filterContent: {
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 24,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mintChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
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
  bottomArea: {
    paddingBottom: 8,
  },
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
});
