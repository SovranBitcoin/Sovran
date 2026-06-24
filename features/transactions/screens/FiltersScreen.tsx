/**
 * Transaction filter selection UI: currency, payment type, direction, status,
 * mint, and the annotation-driven filters (source, P2PK lock, counterparty).
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { HistoryEntry } from '@cashu/coco-core';
import { useMints } from '@cashu/coco-react';
import { z } from 'zod';

import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { extractDomain } from '@/shared/lib/url';
import { mintHistoryEntryExpired } from '@/shared/lib/utils';
import { useHistoryWithMelts } from '@/features/transactions/hooks/useHistoryWithMelts';
import { spacing, radius, alpha } from '@/shared/styles/tokens';
import opacity from 'hex-color-opacity';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import {
  getCounterparty,
  getScanSource,
  getSwap,
  isP2PKLocked,
  isPendingTransaction,
  matchesTransactionFilters,
  type ScanMethod,
  type TransactionDirection,
  type TransactionPaymentType,
} from '@sovranbitcoin/colada';

type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type SourceFilter = 'all' | ScanMethod;
type LockFilter = 'all' | 'locked' | 'unlocked';
type CounterpartyFilter = 'all' | 'with';

const SUPPORTED_CURRENCIES = ['ALL', 'SAT', 'USD', 'EUR', 'GBP'];

const ParamsSchema = z.object({
  currency: z.string().max(16).optional(),
  paymentType: z.enum(['all', 'lightning', 'ecash', 'onchain']).optional(),
  direction: z.enum(['all', 'incoming', 'outgoing']).optional(),
  status: z.enum(['All', 'Confirmed', 'Pending', 'Expired']).optional(),
  mintUrl: z.string().max(2048).optional(),
  source: z.enum(['all', 'qr', 'nfc', 'ble', 'paste', 'deeplink']).optional(),
  lock: z.enum(['all', 'locked', 'unlocked']).optional(),
  counterparty: z.enum(['all', 'with']).optional(),
});

interface ChipProps {
  label: string;
  icon?: string;
  isSelected: boolean;
  onPress: () => void;
}

const Chip: React.FC<ChipProps> = ({ label, icon, isSelected, onPress }) => {
  const [foreground, accent, accentSoft] = useThemeColor([
    'foreground',
    'accent',
    'accent-soft',
  ] as const);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: isSelected ? accentSoft : opacity(foreground, alpha.faint),
          borderColor: isSelected ? accent : opacity(foreground, alpha.subtle),
        },
      ]}>
      {icon ? (
        <Icon
          name={icon}
          size={16}
          color={isSelected ? accent : opacity(foreground, alpha.muted)}
        />
      ) : null}
      <Text
        size={14}
        style={{
          color: isSelected ? foreground : opacity(foreground, alpha.muted),
          fontFamily: 'OxygenBold',
        }}>
        {label}
      </Text>
    </Pressable>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode; scroll?: boolean }> = ({
  title,
  children,
  scroll = false,
}) => {
  const foreground = useThemeColor('foreground');

  return (
    <VStack gap={spacing.sm} style={styles.section}>
      <Text
        size={13}
        style={{
          color: opacity(foreground, alpha.muted),
          fontFamily: 'OxygenBold',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginLeft: spacing.xs,
        }}>
        {title}
      </Text>
      {scroll ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRowScroll}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.chipsRow}>{children}</View>
      )}
    </VStack>
  );
};

const MintSelectorChip: React.FC<{
  showIcon?: boolean;
  name: string;
  iconUrl?: string;
  isSelected: boolean;
  onPress: () => void;
}> = ({ showIcon = true, name, iconUrl, isSelected, onPress }) => {
  const [foreground, accent, accentSoft] = useThemeColor([
    'foreground',
    'accent',
    'accent-soft',
  ] as const);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.mintChip,
        {
          backgroundColor: isSelected ? accentSoft : opacity(foreground, alpha.faint),
          borderColor: isSelected ? accent : opacity(foreground, alpha.subtle),
        },
      ]}>
      {showIcon ? <MintIcon iconUrl={iconUrl} size={22} name={name} alt={`${name} icon`} /> : null}
      <Text
        size={13}
        numberOfLines={1}
        style={{
          color: isSelected ? foreground : opacity(foreground, alpha.strong),
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

  const params = useRouteParams(ParamsSchema, { where: 'filter-flow.filters' });

  const [currency, setCurrency] = useState<string>(params?.currency || 'sat');
  const [paymentType, setPaymentType] = useState<TransactionPaymentType>(
    params?.paymentType || 'all'
  );
  const [direction, setDirection] = useState<TransactionDirection>(params?.direction || 'all');
  const [status, setStatus] = useState<Status>(params?.status || 'All');
  const [mintUrl, setMintUrl] = useState<string>(params?.mintUrl || 'all');
  const [source, setSource] = useState<SourceFilter>(params?.source || 'all');
  const [lock, setLock] = useState<LockFilter>(params?.lock || 'all');
  const [counterparty, setCounterparty] = useState<CounterpartyFilter>(
    params?.counterparty || 'all'
  );

  const mintOptions = [
    { mintUrl: 'all', name: 'All Mints', icon_url: undefined as string | undefined },
    ...trustedMints.map((mint) => ({
      mintUrl: mint.mintUrl,
      name: mint.mintInfo?.name || extractDomain(mint.mintUrl) || 'Unknown',
      icon_url: mint.mintInfo?.icon_url,
    })),
  ];

  const handleApply = () => {
    log.info('tx.filters.apply', {
      currency,
      paymentType,
      direction,
      status,
      source,
      lock,
      counterparty,
      hasMintFilter: mintUrl !== 'all',
    });
    router.dismissTo({
      pathname: '/transactions',
      params: {
        filterCurrency: currency.toLowerCase(),
        filterPaymentType: paymentType,
        filterDirection: direction,
        filterStatus: status,
        filterMintUrl: mintUrl,
        filterSource: source,
        filterLock: lock,
        filterCounterparty: counterparty,
      },
    });
  };

  const handleReset = () => {
    log.info('tx.filters.reset');
    setCurrency('sat');
    setPaymentType('all');
    setDirection('all');
    setStatus('All');
    setMintUrl('all');
    setSource('all');
    setLock('all');
    setCounterparty('all');
  };

  const hasActiveFilters =
    currency.toLowerCase() !== 'sat' ||
    paymentType !== 'all' ||
    direction !== 'all' ||
    status !== 'All' ||
    mintUrl !== 'all' ||
    source !== 'all' ||
    lock !== 'all' ||
    counterparty !== 'all';

  const resultCount = useMemo(() => {
    const normalizedCurrency = currency.toLowerCase();

    const filteredTransactions = history.filter((historyEntry: HistoryEntry) => {
      if (normalizedCurrency !== 'all' && historyEntry.unit !== normalizedCurrency) return false;
      if (mintUrl !== 'all' && historyEntry.mintUrl !== mintUrl) return false;

      // Swap legs are surfaced as a single grouped row (annotation-driven).
      if (getSwap(historyEntry)?.groupId) return false;

      if (!matchesTransactionFilters(historyEntry, { paymentType, direction })) return false;

      if (source !== 'all' && getScanSource(historyEntry)?.method !== source) return false;
      if (lock !== 'all' && isP2PKLocked(historyEntry) !== (lock === 'locked')) return false;
      if (counterparty === 'with' && !getCounterparty(historyEntry)?.pubkey) return false;

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

    return filteredTransactions.length;
  }, [currency, direction, history, mintUrl, paymentType, source, lock, counterparty, status]);

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
            <Text
              size={14}
              style={{ color: opacity(foreground, alpha.muted), fontFamily: 'OxygenBold' }}>
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
        <Section title="Mint" scroll>
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

        <Section title="Source">
          <Chip
            label="All"
            icon="fluent:apps-16-filled"
            isSelected={source === 'all'}
            onPress={() => setSource('all')}
          />
          <Chip
            label="QR"
            icon="stash:qr-code"
            isSelected={source === 'qr'}
            onPress={() => setSource('qr')}
          />
          <Chip
            label="NFC"
            icon="lucide:nfc"
            isSelected={source === 'nfc'}
            onPress={() => setSource('nfc')}
          />
          <Chip
            label="Bluetooth"
            icon="mdi:bluetooth"
            isSelected={source === 'ble'}
            onPress={() => setSource('ble')}
          />
          <Chip
            label="Paste"
            icon="lucide:clipboard-paste"
            isSelected={source === 'paste'}
            onPress={() => setSource('paste')}
          />
          <Chip
            label="Link"
            icon="lucide:link"
            isSelected={source === 'deeplink'}
            onPress={() => setSource('deeplink')}
          />
        </Section>

        <Section title="Lock">
          <Chip
            label="All"
            icon="fluent:apps-16-filled"
            isSelected={lock === 'all'}
            onPress={() => setLock('all')}
          />
          <Chip
            label="Locked"
            icon="solar:key-bold"
            isSelected={lock === 'locked'}
            onPress={() => setLock('locked')}
          />
          <Chip
            label="Unlocked"
            icon="mdi:lock-open-variant-outline"
            isSelected={lock === 'unlocked'}
            onPress={() => setLock('unlocked')}
          />
        </Section>

        <Section title="Counterparty">
          <Chip
            label="All"
            icon="fluent:apps-16-filled"
            isSelected={counterparty === 'all'}
            onPress={() => setCounterparty('all')}
          />
          <Chip
            label="With a person"
            icon="ph:user-bold"
            isSelected={counterparty === 'with'}
            onPress={() => setCounterparty('with')}
          />
        </Section>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  filterContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  section: { marginBottom: spacing.xl },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipsRowScroll: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  mintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
    marginRight: spacing.sm,
  },
  resetButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
});
