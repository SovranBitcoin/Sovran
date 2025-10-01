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
import { CocoTransactionAdapter } from 'helper/coco/typeAdapters';
import { View, HStack, VStack } from 'components/ui/View';
import React from 'react';
// import { useManager } from 'coco-cashu-react'; // Not used in this component

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

const useTransaction = (tx: CocoTransactionAdapter) => {
  const navigation = useTypedNavigation();
  // Use adapted transaction structure
  const isSend = tx.type === 'send';
  const isReceive = tx.type === 'mint';

  // For Transaction.tsx, we don't need to actively listen since it's just displaying status
  // The listening is handled in the confirmation screens
  const isListening = false;

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
    // Check if transaction is paid using adapted state
    const isPaid = tx.paid || tx.state === 'PAID';

    if (!isPaid) {
      switch (tx.type) {
        case 'mint': {
          // Coco uses 'mint' for Lightning-to-ecash
          if (tx.request) {
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
          break;
        }
        case 'send': {
          // Coco uses 'send' for ecash sends
          if (tx.token) {
            navigation.navigate('ecashSendConfirmation', {
              unit: tx.unit,
              token: tx.token,
              amount: tx.amount,
              paymentRequest: tx.paymentRequest,
            });
            return;
          }
          break;
        }
      }
    }

    navigation.navigate('transaction', {
      id: tx.request || tx.token || tx.id || tx.id,
      transactionType: tx.type,
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
  ({ tx, txs }: { tx?: CocoTransactionAdapter; txs?: CocoTransactionAdapter[] }) => {
    const theme = useSelector(memoizedGetTheme);
    const navigation = useTypedNavigation();

    const selectedTx = (tx ?? (txs && txs[0])) as CocoTransactionAdapter;
    const isVirtual = Array.isArray(txs) && txs.length > 0;

    const { isSend, isReceive, showLoading, fiatAmount, handlePress } = useTransaction(selectedTx);

    // For unified styles: flag the transaction for icon change and label tweak
    const effectiveTx: CocoTransactionAdapter & { isVirtual?: boolean } = isVirtual
      ? ({ ...selectedTx, isVirtual: true } as any)
      : selectedTx;

    const safeTx = selectedTx as CocoTransactionAdapter;

    return (
      <TouchableOpacity
        key={safeTx?.id}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'transparent',
          padding: 20,
          paddingLeft: 16,
          paddingRight: 16,
        }}
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
                {isVirtual ? 'Reallocation' : safeTx.type[0].toUpperCase() + safeTx.type.slice(1)}
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
                  {safeTx?.createdAt ? convertTime(new Date(safeTx.createdAt)) : 'Unconfirmed'}
                </UntranslatedText>
                <View>
                  {safeTx.paid || safeTx.state === 'PAID' ? (
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
                  bold
                  size={10}
                  color={theme.greys[100]}
                  style={{
                    alignSelf: 'flex-end',
                    textAlign: 'right',
                  }}>
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
