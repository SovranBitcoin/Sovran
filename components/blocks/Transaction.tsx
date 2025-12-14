import { UntranslatedText } from 'components/ui/Text';
import { formatAmount } from 'helper/currency';
import { convertTime } from 'helper/time';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useTheme } from 'providers/ThemeProvider';
import TransactionIcon from 'components/blocks/TransactionIcon';
import { nip19 } from 'nostr-tools';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import React, { useCallback } from 'react';
import { HistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import { router } from 'expo-router';
import { useScanHistoryStore, ScanSource } from 'stores/scanHistoryStore';
import Icon from 'assets/icons';

export function npubToPubkey(npub: string): string {
  if (!npub) return '';

  if (npub.startsWith('npub')) {
    const data = nip19.decode(npub);
    if (data.type === 'npub') {
      return data.data;
    }
  }
  return npub;
}

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
  const isSend = historyEntry.type === 'send' || historyEntry.type === 'melt';
  const isReceive = historyEntry.type === 'mint' || historyEntry.type === 'receive';

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
        // Extended ReceiveHistoryEntry with token property
        const receiveEntry = historyEntry as ReceiveHistoryEntry & { token?: string };
        router.navigate({
          pathname: '/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(receiveEntry),
          },
        });
        return;
      }
    }
  }, [historyEntry]);

  // Get display label - show "Rolled Back" for rolled back sends
  const getDisplayLabel = () => {
    return historyEntry.type[0].toUpperCase() + historyEntry.type.slice(1);
  };

  return {
    isSend,
    isReceive,
    isRolledBack,
    fiatAmount,
    handlePress,
    displayLabel: getDisplayLabel(),
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
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();

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
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'transparent',
        padding: 20,
        paddingLeft: 16,
        paddingRight: 16,
        opacity: isRolledBack ? 0.33 : 1,
      }}
      onPress={handlePress}>
      <HStack spacing={12} flex={1}>
        <TransactionIcon historyEntry={historyEntry} isLoading={isLoading} />

        <VStack spacing={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={getPrimaryColor('0')} bold size={14}>
              {displayLabel}
            </UntranslatedText>
            <HStack align="center" spacing={0}>
              <UntranslatedText
                color={isSend ? getRedColor('300') : getGreenColor('300')}
                bold
                size={16}>
                {isSend ? '- ' : isReceive ? '+ ' : ''}
              </UntranslatedText>
              <AmountFormatter
                amount={historyEntry.amount}
                unit={historyEntry.unit}
                size={16}
                weight="heavy"
                color={isSend ? getRedColor('300') : getGreenColor('300')}
              />
            </HStack>
          </HStack>

          <HStack justify="space-between" align="center">
            <HStack align="center" spacing={4}>
              <UntranslatedText regular size={10} color={getPrimaryColor('100')}>
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
                  color={getPrimaryColor('100')}
                />
              )}
            </HStack>
            <UntranslatedText
              bold
              size={10}
              color={getPrimaryColor('100')}
              style={{
                alignSelf: 'flex-end',
                textAlign: 'right',
              }}>
              {fiatAmount}
            </UntranslatedText>
          </HStack>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
});

Transaction.displayName = 'Transaction';
