import { UntranslatedText } from 'components/ui/Text';
import { formatCurrency } from 'helper/currency';
import Icon from 'assets/icons';
import { convertTime } from 'helper/time';
import { greens, reds } from 'helper/colors';
import { useSelector } from 'react-redux';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import TransactionIcon from 'components/blocks/TransactionIcon';
import { useTypedNavigation } from 'helper/navigation';
import { nip19 } from 'nostr-tools';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { TransactionData } from 'helper/redux/cashu';
import { View, HStack, VStack } from 'components/ui/View';
import React from 'react';
import { useAutoListenBatch } from 'providers/TransactionsProvider';

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

export const Transaction = React.memo(
  ({ tx, txs }: { tx?: TransactionData; txs?: TransactionData[] }) => {
    const theme = useSelector(memoizedGetTheme);
    const navigation = useTypedNavigation();

    const selectedTx = (tx ?? (txs && txs[0])) as TransactionData;
    const isVirtual = Array.isArray(txs) && txs.length > 0;

    const { isSend, isReceive, showLoading, fiatAmount, handlePress } = useTransaction(selectedTx);

    // For unified styles: flag the transaction for icon change and label tweak
    const effectiveTx: TransactionData & { isVirtual?: boolean } = isVirtual
      ? ({ ...selectedTx, isVirtual: true } as any)
      : selectedTx;

    const safeTx = selectedTx as TransactionData;

    return (
      <TouchableOpacity
        key={safeTx?.txid}
        className="flex flex-row items-center justify-between bg-transparent p-5 pl-4 pr-4"
        onPress={() => {
          if (isVirtual) {
            const batchId = txs?.find((t) => t.batchId)?.batchId;
            if (batchId) {
              navigation.navigate('transaction', {
                id: `batch:${batchId}`,
                transactionType: 'batch',
              });
              return;
            }
          }
          handlePress();
        }}>
        <HStack spacing={12} flex={1}>
          <TransactionIcon transaction={effectiveTx} />

          <VStack spacing={0} flex={1}>
            <HStack justify="space-between" align="flex-end">
              <UntranslatedText color={theme.greys[0]} bold size={14}>
                {isVirtual
                  ? 'Reallocation'
                  : safeTx.transactionType[0].toUpperCase() + safeTx.transactionType.slice(1)}
              </UntranslatedText>
              {isVirtual ? null : (
                <HStack align="center" spacing={0}>
                  <UntranslatedText color={isSend ? reds[300] : greens[300]} bold size={16}>
                    {isVirtual ? '' : isSend ? '- ' : isReceive ? '+ ' : ''}
                  </UntranslatedText>
                  <AmountFormatter
                    amount={safeTx.amount}
                    unit={safeTx.unit}
                    size={16}
                    weight="heavy"
                    color={isSend ? reds[300] : greens[300]}
                  />
                </HStack>
              )}
            </HStack>

            <HStack justify="space-between" align="center">
              <HStack align="center" spacing={4}>
                <UntranslatedText regular size={10} color={theme.greys[100]}>
                  {safeTx?.date ? convertTime(new Date(safeTx.date)) : 'Unconfirmed'}
                </UntranslatedText>
                <View>
                  {safeTx?.paid ? (
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
              {isVirtual ? null : (
                <UntranslatedText
                  className="font-overpass-heavy self-end text-right text-xs"
                  bold
                  size={10}
                  color={theme.greys[100]}>
                  {fiatAmount}
                </UntranslatedText>
              )}
            </HStack>
          </VStack>
        </HStack>
      </TouchableOpacity>
    );
  }
);

Transaction.displayName = 'Transaction';
