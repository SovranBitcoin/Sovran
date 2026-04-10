import React, { useCallback } from 'react';

import { HistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import TransactionIcon from '@/features/transactions/components/TransactionIcon';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatAmount } from '@/shared/lib/currency';
import { convertTime } from '@/shared/lib/time';
import { isOutgoingTransaction } from '@/shared/lib/utils';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, Log } from '@/shared/lib/logger';
import { useScanHistoryStore, ScanSource } from '@/shared/stores/profile/scanHistoryStore';

/**
 * Hook to get the scan source (NFC or QR) for a transaction.
 * Subscribes to the store so the component re-renders when the scan entry is linked.
 */
const useScanSource = (transactionId: string): ScanSource | null => {
  return useScanHistoryStore((state) => {
    const entry = state.entries.find((e) => e.transactionId === transactionId);
    return entry?.source ?? null;
  });
};

/** Returns BIP321 option kinds for a transaction, or null if not BIP321. */
const useBip321Options = (transactionId: string): string[] | null => {
  return useScanHistoryStore((state) => {
    const entry = state.entries.find((e) => e.transactionId === transactionId);
    if (entry?.container !== 'bip321' || !entry.optionKinds?.length) return null;
    return entry.optionKinds;
  });
};

const useHistoryEntry = (historyEntry: HistoryEntry) => {
  const isSend = isOutgoingTransaction(historyEntry);
  const isReceive = !isSend;

  // Check if this is a rolled back send transaction
  const isRolledBack =
    historyEntry.type === 'send' && (historyEntry as SendHistoryEntry).state === 'rolledBack';

  const fiatAmount = formatAmount(
    { amount: Math.abs(historyEntry.amount), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = useCallback((): void => {
    log.debug('transaction.press', { type: historyEntry.type, id: historyEntry.id });
    // Using router.navigate instead of router.push to prevent duplicate navigation
    switch (historyEntry.type) {
      case 'mint': {
        // Coco uses 'mint' for Lightning-to-ecash (Lightning receive)
        router.navigate({
          pathname: '/mintQuote',
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        // Coco uses 'melt' for ecash-to-Lightning (Lightning send)
        router.navigate({
          pathname: '/meltQuote',
          params: {
            meltHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'send': {
        // Coco uses 'send' for ecash sends
        router.navigate({
          pathname: '/sendToken',
          params: {
            sendHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'receive': {
        // Coco uses 'receive' for ecash receives
        router.navigate({
          pathname: '/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(historyEntry as ReceiveHistoryEntry),
          },
        });
        return;
      }
    }
  }, [historyEntry]);

  return {
    isSend,
    isReceive,
    isRolledBack,
    fiatAmount,
    handlePress,
    displayLabel: historyEntry.type[0].toUpperCase() + historyEntry.type.slice(1),
  };
};

interface TransactionProps {
  historyEntry: HistoryEntry;
  /** Optional custom press handler - if provided, overrides default navigation */
  onPress?: (historyEntry: HistoryEntry) => void;
  /** Show a loading spinner on the icon */
  isLoading?: boolean;
}

export const Transaction = React.memo(({ historyEntry, onPress, isLoading }: TransactionProps) => {
  const [foreground, danger, success] = useThemeColor(['foreground', 'danger', 'success'] as const);

  const {
    isSend,
    isReceive,
    isRolledBack,
    fiatAmount,
    handlePress: defaultHandlePress,
    displayLabel,
  } = useHistoryEntry(historyEntry);

  const handlePress = onPress ? () => onPress(historyEntry) : defaultHandlePress;

  // Get scan source (NFC or QR) and BIP321 options - subscribes to store for reactivity
  const scanSource = useScanSource(historyEntry.id);
  const bip321Options = useBip321Options(historyEntry.id);

  return (
    <Log name="Transaction">
      <TouchableOpacity
        key={historyEntry?.id}
        className="flex-row items-center justify-between bg-transparent px-4 py-5"
        style={isRolledBack ? { opacity: 0.33 } : undefined}
        onPress={handlePress}>
        <HStack spacing={12} flex={1}>
          <TransactionIcon historyEntry={historyEntry} isLoading={isLoading} />

          <VStack spacing={0} flex={1}>
            <HStack justify="space-between" align="flex-end">
              <UntranslatedText color={foreground} bold size={14}>
                {displayLabel}
              </UntranslatedText>
              <HStack align="center" spacing={0}>
                <UntranslatedText overpass color={isSend ? danger : success} bold size={16}>
                  {isSend ? '- ' : isReceive ? '+ ' : ''}
                </UntranslatedText>
                <AmountFormatter
                  amount={historyEntry.amount}
                  unit={historyEntry.unit}
                  size={16}
                  weight="heavy"
                  color={isSend ? danger : success}
                />
              </HStack>
            </HStack>

            <HStack justify="space-between" align="center">
              <HStack align="center" spacing={4}>
                <UntranslatedText size={10} color={opacity(foreground, 0.8)}>
                  {historyEntry?.createdAt
                    ? convertTime(new Date(historyEntry.createdAt))
                    : 'Unconfirmed'}
                </UntranslatedText>
                {scanSource && (
                  <Icon
                    name={
                      scanSource === 'nfc'
                        ? 'lucide:nfc'
                        : scanSource === 'paste'
                          ? 'lucide:clipboard-paste'
                          : scanSource === 'deeplink'
                            ? 'lucide:link'
                            : 'stash:qr-code'
                    }
                    size={10}
                    color={opacity(foreground, 0.8)}
                  />
                )}
                {bip321Options &&
                  (() => {
                    const hasLightning = bip321Options.some(
                      (k) => k === 'lightningInvoice' || k === 'lightningAddress' || k === 'lnurlp'
                    );
                    const hasEcash = bip321Options.some(
                      (k) => k === 'paymentRequest' || k === 'ecashToken'
                    );
                    const usedLightning = historyEntry.type === 'melt';
                    // Sort: used method first
                    const items = [
                      hasLightning && { name: 'mdi:lightning-bolt', used: usedLightning },
                      hasEcash && { name: 'majesticons:coins', used: !usedLightning },
                    ].filter(Boolean) as { name: string; used: boolean }[];
                    items.sort((a, b) => (a.used === b.used ? 0 : a.used ? -1 : 1));
                    return items.map((item) => (
                      <Icon
                        key={item.name}
                        name={item.name}
                        size={10}
                        color={opacity(foreground, item.used ? 0.8 : 0.4)}
                      />
                    ));
                  })()}
              </HStack>
              <UntranslatedText
                overpass
                bold
                size={10}
                color={opacity(foreground, 0.8)}
                className="self-end text-right">
                {fiatAmount}
              </UntranslatedText>
            </HStack>
          </VStack>
        </HStack>
      </TouchableOpacity>
    </Log>
  );
});

Transaction.displayName = 'Transaction';
