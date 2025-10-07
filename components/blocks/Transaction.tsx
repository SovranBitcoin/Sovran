import { UntranslatedText } from 'components/ui/Text';
import { formatAmount } from 'helper/currency';
import { convertTime } from 'helper/time';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useTheme } from 'providers/ThemeProvider';
import TransactionIcon from 'components/blocks/TransactionIcon';
import { nip19 } from 'nostr-tools';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { HStack, VStack } from 'components/ui/View';
import React from 'react';
import { HistoryEntry, ReceiveHistoryEntry } from 'coco-cashu-core';
import { router } from 'expo-router';

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

const useHistoryEntry = (historyEntry: HistoryEntry) => {
  const isSend = historyEntry.type === 'send' || historyEntry.type === 'melt';
  const isReceive = historyEntry.type === 'mint' || historyEntry.type === 'receive';

  const fiatAmount = formatAmount(
    { amount: Math.abs(historyEntry.amount), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = (): void => {
    switch (historyEntry.type) {
      case 'mint': {
        // Coco uses 'mint' for Lightning-to-ecash (Lightning receive)
        router.push({
          pathname: '/lightningReceiveConfirmation',
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        // Coco uses 'melt' for ecash-to-Lightning (Lightning send)
        router.push({
          pathname: '/lightningSendConfirmation',
          params: {
            meltHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'send': {
        // Coco uses 'send' for ecash sends
        router.push({
          pathname: '/ecashSendConfirmation',
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
        router.push({
          pathname: '/ecashReceiveConfirmation',
          params: {
            receiveHistoryEntry: JSON.stringify(receiveEntry),
          },
        });
        return;
      }
    }
  };

  return {
    isSend,
    isReceive,
    fiatAmount,
    handlePress,
  };
};

export const Transaction = React.memo(({ historyEntry }: { historyEntry: HistoryEntry }) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();

  const { isSend, isReceive, fiatAmount, handlePress } = useHistoryEntry(historyEntry);

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
      }}
      onPress={handlePress}>
      <HStack spacing={12} flex={1}>
        <TransactionIcon historyEntry={historyEntry} />

        <VStack spacing={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={getPrimaryColor('0')} bold size={14}>
              {historyEntry.type[0].toUpperCase() + historyEntry.type.slice(1)}
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
