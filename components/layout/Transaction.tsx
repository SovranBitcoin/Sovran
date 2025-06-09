import { UntranslatedText, View } from 'components/common/Themed';
import { useMemo } from 'react';
import { formatCurrency, formatCurrencyWrapper } from 'helper/currency';
import Icon, { LightningUnit, BtcUnit } from 'assets/icons';
import { convertTime } from 'helper/time';
import { greens, greys, reds, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import TransactionIcon, { TransactionData } from 'components/common/TransactionIcon';
import { truncateMiddle } from 'helper/strings';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { useTypedNavigation } from 'helper/navigation';
import { nip19 } from 'nostr-tools';
import { Text } from 'components/common/Themed';
import { AmountFormatter } from 'components/common/AmountFormatter';
interface TransactionStatus {
  block_time: number;
  [key: string]: any;
}

interface NostrData {
  pubkey: string;
  [key: string]: any;
}


interface AccountData {
  accountIndex: number;
  [key: string]: any;
}

interface ConnectionData {
  id: string;
  [key: string]: any;
}

interface ProfileData {
  pubkey: string;
  picture?: string;
  image?: string;
  profile?: {
    picture?: string;
    image?: string;
  };
  [key: string]: any;
}

interface TransactionProps {
  tx: TransactionData;
  transactions: TransactionData[];
  account?: AccountData;
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

/**
 * Transaction component displays transaction details with appropriate formatting
 */
export function Transaction({ tx, transactions, account }: TransactionProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();

  const { settings } = useSettings();
  const { activeConnections } = useTransactions();

  // Find related transaction for buys/sells
  const relatedTransaction = useMemo(() => {
    return transactions.find(
      (tx_) => (tx.isBuy && tx.isBuy === tx_.token) || (tx.isSell && tx.token === tx_.isBuy)
    );
  }, [tx, transactions]);

  const isBuyTransaction = tx.isBuy && relatedTransaction;
  const isSellTransaction = tx.isSell && relatedTransaction;
  const isSend = tx.transactionType === 'send';
  const isReceive = tx.transactionType === 'receive';

  const isListening = activeConnections?.some((connection: ConnectionData) =>
    connection.id.includes(tx.request || tx.token)
  );

  const showLoading = isListening;


  /**
   * Handle navigation when transaction is pressed
   */
  const handlePress = (): void => {
    const isPaid = tx.paid;

    if (tx.request && !isPaid) {
      navigation.navigate('lightningReceiveConfirmation', {
        unit: tx.unit,
        request: tx.request,
        amount: tx.amount,
        transaction: JSON.stringify(tx),
        unifiedRequest: tx.unifiedRequest,
        paymentRequest: tx.paymentRequest,
      });
    } else if (tx.type === 'ecash' && !isPaid && isSend) {
      navigation.navigate('ecashSendConfirmation', {
        unit: tx.unit,
        token: tx.token,
        amount: tx.amount,
      });
    } else {
      navigation.navigate('transaction', {
        id: tx.request || tx.token || tx.txid || tx.id,
        transactionType: tx.transactionType,
        accountIndex: account?.accountIndex,
      });
    }
  };

  /**
   * Format transaction direction text based on transaction type
   */
  const getTransactionDirection = (): string => {
    if (isBuyTransaction && relatedTransaction) {
      const from =
        relatedTransaction.unit === 'sat' ? 'BTC' : relatedTransaction.unit.toUpperCase();
      const to = tx.unit === 'sat' ? 'BTC' : tx.unit.toUpperCase();
      return `${from} → ${to}`.toUpperCase();
    } else if (isSellTransaction && relatedTransaction) {
      const from = tx.unit === 'sat' ? 'BTC' : tx.unit.toUpperCase();
      const to = relatedTransaction.unit === 'sat' ? 'BTC' : relatedTransaction.unit.toUpperCase();
      return `${from} → ${to}`.toUpperCase();
    }
    return (
      tx.transactionType[0].toUpperCase() + tx.transactionType.slice(1) ||
      tx?.from ||
      tx?.to ||
      truncateMiddle(tx.txid || tx.request || tx.token || '', 3) ||
      'Unknown'
    );
  };

  /**
   * Format currency amount with appropriate display options
   */
  const formatAmount = (
    transaction: TransactionData,
    options: {
      precision?: number;
      currencyDisplay?: string;
      denomination?: string;
    } = {}
  ): string | null => {
    if (!transaction?.amount) return null;
    return formatCurrency(
      {
        currency: transaction.unit === 'sat' ? 'BTC' : (transaction.unit.toUpperCase() as any),
        value: Math.abs(transaction.amount),
        denomination: transaction.unit === 'sat' ? 'sats' : (transaction.unit as any),
      },
      {
        locale: 'en-US',
        precision:
          options.precision !== undefined ? options.precision : transaction.unit === 'sat' ? 0 : 2,
        currencyDisplay: options.currencyDisplay || ('name' as any),
        denomination:
          options.denomination || (transaction.unit === 'sat' ? 'sats' : (transaction.unit as any)),
      }
    );
  };


  /**
   * Render the amount display with appropriate formatting
   */
  const renderAmountDetails = (): JSX.Element => {
    const sign = isSend ? '-' : isReceive ? '+' : '';
    const precision = tx.unit === 'sat' ? (settings.display_btc === 0 ? 8 : 0) : 2;
    const currencyDisplay =
      tx.unit === 'sat' && [0, 1, 3].includes(settings.display_btc) ? 'none' : 'none';
    const denomination =
      tx.unit === 'sat' ? (settings.display_btc === 0 ? 'btc' : 'sats') : tx.unit;

    const amount = tx.amount;
    const relatedAmount = relatedTransaction ? formatAmount(relatedTransaction) : null;

    return (
      <>
        <View className="flex flex-row items-center bg-transparent">
          {sign && (
            <UntranslatedText
              style={
                isSend
                  ? {
                      fontFamily: 'OverpassBold',
                      fontSize: 16,
                      color: shades[300],
                      marginRight: 4,
                    }
                  : {
                      fontFamily: 'OverpassBold',
                      fontSize: 16,
                      color: greens[300],
                      marginRight: 4,
                      marginBottom: -1,
                      textShadowColor: opacity(greys(theme)[0], 0.5),
                      textShadowOffset: { width: 0, height: 0 },
                      textShadowRadius: 1,
                    }
              }>
              {sign}
            </UntranslatedText>
          )}
          <AmountFormatter
            amount={amount}
            unit={tx.unit}
            size={16}
            weight="heavy"
            color={isSend ? reds[300] : greens[300]}
          />
          {/* {[0, 3].includes(settings.display_btc) && tx.unit === 'sat' && (
            <BtcUnit width={'16'} height="16" color={isSend ? reds[300] : greens[300]} />
          )}
          <UntranslatedText
            style={{
              fontFamily: 'OverpassBold',
              fontSize: 14,
              color: isSend ? reds[300] : greens[300],
              margin: 0,
              fontWeight: 'bold',
              alignSelf: 'center',
              textShadowColor: opacity(greys(theme)[0], 0.5),
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 1,
            }}>
            {amount}
          </UntranslatedText> */}

          {/* {settings.display_btc === 1 && tx.unit === 'sat' && (
            <LightningUnit
              style={{
                marginBottom: 6,
              }}
              width={'14'}
              height="14"
              color={isSend ? reds[300] : greens[300]}
            />
          )} */}
        </View>
        {relatedAmount && (
          <View className="flex flex-row items-center bg-transparent">
            <UntranslatedText
              style={{
                fontFamily: 'OverpassBold',
                fontSize: 12,
                color: !isSend ? shades[300] : greens[300],
                marginRight: 4,
                ...(isSend && {
                  marginBottom: -1,
                  textShadowColor: opacity(greys(theme)[0], 0.5),
                  textShadowOffset: { width: 0, height: 0 },
                  textShadowRadius: 1,
                }),
              }}>
              {isSend ? '+' : '-'}
            </UntranslatedText>
            <UntranslatedText
              style={{
                fontFamily: 'OverpassHeavy',
                fontSize: 10,
                color: greys(theme)[200],
                textAlign: 'right',
                alignSelf: 'flex-end',
              }}>
              {relatedAmount}
            </UntranslatedText>
          </View>
        )}
      </>
    );
  };

  /**
   * Get formatted date string from transaction timestamp
   */
  const getFormattedDate = (): string => {
    if (tx.date || tx?.status?.block_time) {
      return convertTime(new Date(tx.date || tx?.status.block_time * 1000));
    }
    return 'Unconfirmed';
  };

  return (
    <View key={tx.txid} className="bg-transparent">
      <TouchableOpacity className="bg-transparent" onPress={handlePress}>
        <View className="flex flex-row items-center justify-between p-5 pl-4 pr-4">
          <TransactionIcon transaction={tx} />

          <View className="ml-3 flex-grow flex-col bg-transparent">
            <View className="flex flex-row items-end justify-between bg-transparent">
              <UntranslatedText
                style={{
                  fontFamily: 'OverpassBold',
                  fontSize: 14,
                  color: greys(theme)[0],
                }}>
                {getTransactionDirection()}
              </UntranslatedText>
              {renderAmountDetails()}
            </View>

            <View className="flex flex-row justify-between bg-transparent">
              <View className="flex flex-row items-center">
                <UntranslatedText
                  style={{
                    fontFamily: 'OverpassRegular',
                    fontSize: 10,
                    color: greys(theme)[200],
                  }}>
                  {getFormattedDate()}
                </UntranslatedText>
                {showLoading && (
                  <View className="pl-1">
                    <Icon
                      size={8}
                      name="ant-design:loading-outlined"
                      color={greys(theme)[100]}
                      spin={{
                        delay: 0,
                        duration: 1000,
                        outputRange: ['0deg', '360deg'],
                        easing: 'linear',
                      }}
                    />
                  </View>
                )}
              </View>

              <UntranslatedText
                className="font-overpass-heavy self-end text-right text-xs"
                style={{
                  fontFamily: 'OverpassBold',
                  fontSize: 10,
                  color: greys(theme)[200],
                }}>
                {formatCurrency(
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
                )}
              </UntranslatedText>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}
