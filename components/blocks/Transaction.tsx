import React, { useCallback } from 'react';

import { HistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import TransactionIcon from 'components/blocks/TransactionIcon';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { UntranslatedText } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { formatAmount } from 'helper/currency';
import { convertTime } from 'helper/time';
import { isOutgoingTransaction } from 'helper/utils';
import { useThemeColor } from 'hooks/useThemeColor';
import { useScanHistoryStore, ScanSource } from 'stores/scanHistoryStore';

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

  // Get scan source (NFC or QR) - subscribes to store for reactivity
  const scanSource = useScanSource(historyEntry.id);

  return (
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
  );
});

Transaction.displayName = 'Transaction';
