import { UntranslatedText } from 'components/ui/Text';
import { formatAmount } from 'helper/currency';
import Icon from 'assets/icons';
import { convertTime } from 'helper/time';
import { greens, reds } from 'helper/colors';
import { useSelector } from 'react-redux';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import TransactionIcon from 'components/blocks/TransactionIcon';
import { router } from 'expo-router';
import { nip19 } from 'nostr-tools';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { CocoTransactionAdapter } from 'helper/coco/typeAdapters';
import { View, HStack, VStack } from 'components/ui/View';
import React from 'react';

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

const useHistoryEntry = (historyEntry: CocoTransactionAdapter) => {
  const isSend = historyEntry.type === 'send';
  const isReceive = historyEntry.type === 'mint';
  const isPaid = historyEntry.state === 'PAID';

  // For HistoryEntryItem, we don't need to actively listen since it's just displaying status
  // The listening is handled in the confirmation screens
  const isListening = false;

  const fiatAmount = formatAmount(
    { amount: Math.abs(historyEntry.amount), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = (): void => {
    if (!isPaid) {
      switch (historyEntry.type) {
        case 'mint': {
          // Coco uses 'mint' for Lightning-to-ecash
          if (historyEntry.request) {
            router.push({
              pathname: '/lightningReceiveConfirmation',
              params: {
                unit: historyEntry.unit,
                request: historyEntry.request,
                amount: historyEntry.amount.toString(),
                historyEntry: JSON.stringify(historyEntry),
                unifiedRequest: historyEntry.unifiedRequest,
                paymentRequest: historyEntry.paymentRequest,
              },
            });
            return;
          }
          break;
        }
        case 'send': {
          // Coco uses 'send' for ecash sends
          if (historyEntry.token) {
            router.push({
              pathname: '/ecashSendConfirmation',
              params: {
                unit: historyEntry.unit,
                token: JSON.stringify(historyEntry.token),
                amount: historyEntry.amount.toString(),
                paymentRequest: historyEntry.paymentRequest,
              },
            });
            return;
          }
          break;
        }
      }
    }

    router.push({
      pathname: '/transaction',
      params: {
        id: historyEntry.request || historyEntry.token || historyEntry.id,
        historyEntryType: historyEntry.type,
      },
    });
  };

  return {
    isSend,
    isReceive,
    isPaid,
    showLoading: isListening,
    fiatAmount,
    handlePress,
  };
};

export const Transaction = React.memo(
  ({ historyEntry }: { historyEntry: CocoTransactionAdapter }) => {
    const theme = useSelector(memoizedGetTheme);

    const { isSend, isReceive, isPaid, showLoading, fiatAmount, handlePress } =
      useHistoryEntry(historyEntry);

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
              <UntranslatedText color={theme.greys[0]} bold size={14}>
                {historyEntry.type[0].toUpperCase() + historyEntry.type.slice(1)}
              </UntranslatedText>
              <HStack align="center" spacing={0}>
                <UntranslatedText color={isSend ? reds[300] : greens[300]} bold size={16}>
                  {isSend ? '- ' : isReceive ? '+ ' : ''}
                </UntranslatedText>
                <AmountFormatter
                  amount={historyEntry.amount}
                  unit={historyEntry.unit}
                  size={16}
                  weight="heavy"
                  color={isSend ? reds[300] : greens[300]}
                />
              </HStack>
            </HStack>

            <HStack justify="space-between" align="center">
              <HStack align="center" spacing={4}>
                <UntranslatedText regular size={10} color={theme.greys[100]}>
                  {historyEntry?.createdAt
                    ? convertTime(new Date(historyEntry.createdAt))
                    : 'Unconfirmed'}
                </UntranslatedText>
                <View>
                  {isPaid ? (
                    <Icon size={10} name="simple-line-icons:check" color={theme.greys[100]} />
                  ) : showLoading ? (
                    <Icon
                      size={10}
                      name="ant-design:loading-outlined"
                      color={theme.greys[50]}
                      spin={{
                        delay: 0,
                        duration: 1000,
                        outputRange: ['0deg', '360deg'],
                        easing: 'linear',
                      }}
                    />
                  ) : null}
                </View>
              </HStack>
              <UntranslatedText
                bold
                size={10}
                color={theme.greys[100]}
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
  }
);

Transaction.displayName = 'Transaction';
