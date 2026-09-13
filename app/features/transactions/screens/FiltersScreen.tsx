/**
 * Transaction filter selection UI: currency, payment type, direction, status,
 * mint, and the annotation-driven filters (source, P2PK lock, counterparty).
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { HistoryEntry } from '@cashu/coco-core';
import { useMints } from '@cashu/coco-react';
import { z } from 'zod';

import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { Section } from '@/shared/ui/composed/Section';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { extractDomain } from '@/shared/lib/url';
import { mintHistoryEntryExpired } from '@/shared/lib/utils';
import { useHistoryWithMelts } from '@/features/transactions/hooks/useHistoryWithMelts';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import {
  getCounterparty,
  getScanSource,
  getSwap,
  getZap,
  isP2PKLocked,
  isPendingTransaction,
  matchesTransactionFilters,
  type ScanMethod,
  type TransactionDirection,
  type TransactionPaymentType,
} from 'wallet';

type Status = 'All' | 'Confirmed' | 'Pending' | 'Expired';
type SourceFilter = 'all' | ScanMethod;
type LockFilter = 'all' | 'locked' | 'unlocked';
type CounterpartyFilter = 'all' | 'with';
type ZapFilter = 'all' | 'zaps';

const SUPPORTED_CURRENCIES = ['ALL', 'SAT', 'USD', 'EUR', 'GBP'];

const PAYMENT_TYPE_OPTIONS = {
  all: { label: 'All', icon: 'fluent:apps-16-filled' },
  lightning: { label: 'Lightning', icon: 'mingcute:lightning-fill' },
  ecash: { label: 'Ecash', icon: 'majesticons:coins' },
  onchain: { label: 'Onchain', icon: 'hugeicons:blockchain-01' },
} as const;

const DIRECTION_OPTIONS = {
  all: { label: 'All', icon: 'fluent:arrow-swap-16-filled' },
  incoming: { label: 'In', icon: 'fluent:arrow-download-16-filled' },
  outgoing: { label: 'Out', icon: 'fluent:arrow-upload-16-filled' },
} as const;

const STATUS_OPTIONS = {
  All: { label: 'All', icon: 'fluent:list-16-filled' },
  Confirmed: { label: 'Confirmed', icon: 'fluent:checkmark-circle-16-filled' },
  Pending: { label: 'Pending', icon: 'fluent:clock-16-filled' },
  Expired: { label: 'Expired', icon: 'fluent:dismiss-circle-16-filled' },
} as const;

const SOURCE_OPTIONS = {
  all: { label: 'All', icon: 'fluent:apps-16-filled' },
  qr: { label: 'QR', icon: 'stash:qr-code' },
  nfc: { label: 'NFC', icon: 'lucide:nfc' },
  ble: { label: 'Bluetooth', icon: 'mdi:bluetooth' },
  paste: { label: 'Paste', icon: 'lucide:clipboard-paste' },
  deeplink: { label: 'Link', icon: 'lucide:link' },
} as const;

const LOCK_OPTIONS = {
  all: { label: 'All', icon: 'fluent:apps-16-filled' },
  locked: { label: 'Locked', icon: 'solar:key-bold' },
  unlocked: { label: 'Unlocked', icon: 'mdi:lock-open-variant-outline' },
} as const;

const COUNTERPARTY_OPTIONS = {
  all: { label: 'All', icon: 'fluent:apps-16-filled' },
  with: { label: 'With a person', icon: 'ph:user-bold' },
} as const;

const ZAP_OPTIONS = {
  all: { label: 'All', icon: 'fluent:apps-16-filled' },
  zaps: { label: 'Zapped posts', icon: 'mingcute:lightning-fill' },
} as const;

const ParamsSchema = z.object({
  currency: z.string().max(16).optional(),
  paymentType: z.enum(['all', 'lightning', 'ecash', 'onchain']).optional(),
  direction: z.enum(['all', 'incoming', 'outgoing']).optional(),
  status: z.enum(['All', 'Confirmed', 'Pending', 'Expired']).optional(),
  mintUrl: z.string().max(2048).optional(),
  source: z.enum(['all', 'qr', 'nfc', 'ble', 'paste', 'deeplink']).optional(),
  lock: z.enum(['all', 'locked', 'unlocked']).optional(),
  counterparty: z.enum(['all', 'with']).optional(),
  zap: z.enum(['all', 'zaps']).optional(),
});

export function FiltersScreen() {
  useLifecycleLogger('FiltersScreen');
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
  const [zap, setZap] = useState<ZapFilter>(params?.zap || 'all');

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
    log.info('tx.filters.apply', {
      currency,
      paymentType,
      direction,
      status,
      source,
      lock,
      counterparty,
      zap,
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
        filterZap: zap,
      },
    });
  }, [currency, paymentType, direction, status, mintUrl, source, lock, counterparty, zap]);

  const handleReset = useCallback(() => {
    log.info('tx.filters.reset');
    setCurrency('sat');
    setPaymentType('all');
    setDirection('all');
    setStatus('All');
    setMintUrl('all');
    setSource('all');
    setLock('all');
    setCounterparty('all');
    setZap('all');
  }, []);

  const hasActiveFilters = useMemo(
    () =>
      currency.toLowerCase() !== 'sat' ||
      paymentType !== 'all' ||
      direction !== 'all' ||
      status !== 'All' ||
      mintUrl !== 'all' ||
      source !== 'all' ||
      lock !== 'all' ||
      counterparty !== 'all' ||
      zap !== 'all',
    [currency, paymentType, direction, status, mintUrl, source, lock, counterparty, zap]
  );

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
      if (zap === 'zaps' && !getZap(historyEntry)?.eventId) return false;

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
  }, [currency, direction, history, mintUrl, paymentType, source, lock, counterparty, zap, status]);

  return (
    <ScreenWrapper
      name="FiltersScreen"
      contentPadding={0}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                testID: 'filters-reset',
                text: 'Reset',
                variant: 'secondary',
                condition: hasActiveFilters,
                onPress: handleReset,
              },
              {
                testID: 'filters-apply',
                text: `Apply Filters (${resultCount})`,
                variant: 'primary',
                onPress: async () => handleApply(),
              },
            ]}
          />
        </BottomButtons>
      }>
      <View className="px-4 pb-4">
        <Section title="Mint">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row items-center gap-2 pr-4">
              {mintOptions.map((mint) => (
                <CapsuleButton
                  key={mint.mintUrl}
                  label={mint.name}
                  iconNode={
                    mint.mintUrl !== 'all' ? (
                      <MintIcon
                        iconUrl={mint.icon_url}
                        size={22}
                        name={mint.name}
                        alt={`${mint.name} icon`}
                      />
                    ) : undefined
                  }
                  isActive={mintUrl === mint.mintUrl}
                  selectedVariant="contrast"
                  fitContent
                  accessibilityRole="radio"
                  onPress={() => setMintUrl(mint.mintUrl)}
                  testID={`filter-mint-${mint.mintUrl}`}
                />
              ))}
            </View>
          </ScrollView>
        </Section>

        <Section title="Currency">
          <PillTabs
            selectedVariant="contrast"
            tabs={SUPPORTED_CURRENCIES}
            activeTab={currency.toUpperCase()}
            onTabChange={(value) => setCurrency(value.toLowerCase())}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-currency-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Type">
          <PillTabs
            selectedVariant="contrast"
            tabs={['all', 'lightning', 'ecash', 'onchain'] as const}
            activeTab={paymentType}
            onTabChange={setPaymentType}
            labelFor={(value) => PAYMENT_TYPE_OPTIONS[value].label}
            iconFor={(value) => PAYMENT_TYPE_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-type-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Direction">
          <PillTabs
            selectedVariant="contrast"
            tabs={['all', 'incoming', 'outgoing'] as const}
            activeTab={direction}
            onTabChange={setDirection}
            labelFor={(value) => DIRECTION_OPTIONS[value].label}
            iconFor={(value) => DIRECTION_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-direction-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Status">
          <PillTabs
            selectedVariant="contrast"
            tabs={['All', 'Confirmed', 'Pending', 'Expired'] as const}
            activeTab={status}
            onTabChange={setStatus}
            labelFor={(value) => STATUS_OPTIONS[value].label}
            iconFor={(value) => STATUS_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-status-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Source">
          <PillTabs
            selectedVariant="contrast"
            tabs={['all', 'qr', 'nfc', 'ble', 'paste', 'deeplink'] as const}
            activeTab={source}
            onTabChange={setSource}
            labelFor={(value) => SOURCE_OPTIONS[value].label}
            iconFor={(value) => SOURCE_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-source-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Lock">
          <PillTabs
            selectedVariant="contrast"
            tabs={['all', 'locked', 'unlocked'] as const}
            activeTab={lock}
            onTabChange={setLock}
            labelFor={(value) => LOCK_OPTIONS[value].label}
            iconFor={(value) => LOCK_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-lock-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Counterparty">
          <PillTabs
            selectedVariant="contrast"
            tabs={['all', 'with'] as const}
            activeTab={counterparty}
            onTabChange={setCounterparty}
            labelFor={(value) => COUNTERPARTY_OPTIONS[value].label}
            iconFor={(value) => COUNTERPARTY_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-counterparty-${value.toLowerCase()}`}
          />
        </Section>

        <Section title="Zaps">
          <PillTabs
            selectedVariant="contrast"
            tabs={['all', 'zaps'] as const}
            activeTab={zap}
            onTabChange={setZap}
            labelFor={(value) => ZAP_OPTIONS[value].label}
            iconFor={(value) => ZAP_OPTIONS[value].icon}
            accessibilityRole="radio"
            testIDFor={(value) => `filter-zap-${value.toLowerCase()}`}
          />
        </Section>
      </View>
    </ScreenWrapper>
  );
}
