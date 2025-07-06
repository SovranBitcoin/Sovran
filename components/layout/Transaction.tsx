import { UntranslatedText } from 'components/common/Text';
import { formatCurrency } from 'helper/currency';
import Icon from 'assets/icons';
import { convertTime } from 'helper/time';
import { greens, reds } from 'helper/colors';
import { useSelector } from 'react-redux';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import TransactionIcon from 'components/common/TransactionIcon';
import { useAutoListenBatch } from 'components/providers/TransactionsProvider';
import { useTypedNavigation } from 'helper/navigation';
import { nip19 } from 'nostr-tools';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { TransactionData } from 'helper/redux/cashu';
import { View } from 'components/common/View';
import React from 'react';

interface ConnectionData {
  id: string;
  [key: string]: any;
}

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

const useTransaction = (tx: TransactionData) => {
  const navigation = useTypedNavigation();
  const isSend = tx.transactionType === 'send';
  const isReceive = tx.transactionType === 'receive';

  const { isListening } = useAutoListenBatch([tx], { enabled: false });

  const fiatAmount = formatCurrency(
    {
      currency: tx.unit === 'sat' ? 'BTC' : (tx.unit.toUpperCase() as any),
      value: Math.abs(tx.amount),
      denomination: tx.unit === 'sat' ? 'sats' : (tx.unit as any),
    },
    {
      locale: 'en-US',
      precision: tx.unit === 'sat' ? 4 : 2,
      currencyDisplay: 'symbol',
      denomination: 'usd',
    }
  );

  const handlePress = (): void => {
    if (!tx.paid) {
      switch (tx.type) {
        case 'lightning': {
          navigation.navigate('lightningReceiveConfirmation', {
            unit: tx.unit,
            request: tx.request,
            amount: tx.amount,
            transaction: JSON.stringify(tx),
            unifiedRequest: tx.unifiedRequest,
            paymentRequest: tx.paymentRequest,
          });
          return;
        }
        case 'ecash': {
          navigation.navigate('ecashSendConfirmation', {
            unit: tx.unit,
            token: tx.token,
            amount: tx.amount,
            paymentRequest: tx.paymentRequest,
          });
          return;
        }
      }
    }

    navigation.navigate('transaction', {
      id: tx.request || tx.token || tx.txid || tx.id,
      transactionType: tx.transactionType,
    });
  };

  return {
    isSend,
    isReceive,
    showLoading: isListening,
    fiatAmount,
    handlePress,
  };
};

export const Transaction = React.memo(({ tx }) => {
  const theme = useSelector(memoizedGetTheme);

  const { isSend, isReceive, showLoading, fiatAmount, handlePress } = useTransaction(tx);

  return (
    <TouchableOpacity
      key={tx.txid}
      className="flex flex-row items-center justify-between bg-transparent p-5 pl-4 pr-4"
      onPress={handlePress}>
      <TransactionIcon transaction={tx} />

      <View className="ml-3 flex-grow flex-col bg-transparent">
        <View className="flex flex-row items-end justify-between bg-transparent">
          <UntranslatedText color={theme.greys[0]} bold size={14}>
            {tx.transactionType[0].toUpperCase() + tx.transactionType.slice(1)}
          </UntranslatedText>
          <View className="flex flex-row items-center bg-transparent">
            <UntranslatedText color={isSend ? reds[300] : greens[300]} bold size={16}>
              {isSend ? '- ' : isReceive ? '+ ' : ''}
            </UntranslatedText>
            <AmountFormatter
              amount={tx.amount}
              unit={tx.unit}
              size={16}
              weight="heavy"
              color={isSend ? reds[300] : greens[300]}
            />
          </View>
        </View>

        <View className="flex flex-row justify-between bg-transparent">
          <View className="flex flex-row items-center">
            <UntranslatedText regular size={10} color={theme.greys[100]}>
              {tx?.date ? convertTime(new Date(tx.date)) : 'Unconfirmed'}
            </UntranslatedText>
            <View className="pl-1">
              {tx?.paid ? (
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
          </View>

          <UntranslatedText
            className="font-overpass-heavy self-end text-right text-xs"
            bold
            size={10}
            color={theme.greys[100]}>
            {fiatAmount}
          </UntranslatedText>
        </View>
      </View>
    </TouchableOpacity>
  );
});

Transaction.displayName = 'Transaction';
