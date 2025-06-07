import { UntranslatedText, View } from 'components/common/Themed';
import { useMemo } from 'react';
import { formatCurrency, formatCurrencyWrapper } from 'helper/currency';
import Icon, { LightningUnit, BtcUnit } from 'assets/icons';
import { convertTime } from 'helper/time';
import { greens, greys, reds, shades } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { useEsims } from 'helper/redux/esim';
import { useSelector } from 'react-redux';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import CachedImage from 'components/common/Image';
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

interface TransactionData {
  id?: string;
  txid?: string;
  request?: string;
  token?: string;
  unit: string;
  amount: number;
  date?: string;
  transactionType: 'send' | 'receive' | string;
  type?: string;
  isBuy?: string;
  isSell?: boolean;
  paid?: boolean;
  isCancel?: boolean;
  unifiedRequest?: string;
  paymentRequest?: string;
  from?: string;
  to?: string;
  status?: TransactionStatus;
  nostr?: NostrData;
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
  const { profiles, search } = useNostr();
  const { esims } = useEsims();
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

  // Get profile picture from nostr data
  const profilePicture =
    search?.find(
      (s: ProfileData) =>
        s?.pubkey === npubToPubkey(tx?.nostr?.pubkey || tx?.fromNIP05?.split('@')[0])
    )?.profile?.picture ||
    profiles?.find(
      (p: ProfileData) =>
        p?.pubkey === npubToPubkey(tx?.nostr?.pubkey || tx?.fromNIP05?.split('@')[0])
    )?.picture ||
    search?.find(
      (s: ProfileData) =>
        s?.pubkey === npubToPubkey(tx?.nostr?.pubkey || tx?.fromNIP05?.split('@')[0])
    )?.profile?.image ||
    profiles?.find(
      (p: ProfileData) =>
        p?.pubkey === npubToPubkey(tx?.nostr?.pubkey || tx?.fromNIP05?.split('@')[0])
    )?.image;

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
   * Component to display transaction icon with status indicator
   */
  const IconContainer = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <View className="relative h-7 w-7 bg-transparent">{children}</View>
  );

  /**
   * Status indicator for transaction icons
   */
  const StatusIndicator = ({
    isCancel,
    fromNIP05,
  }: {
    isCancel?: boolean;
    fromNIP05?: boolean;
  }): JSX.Element => (
    <View
      style={{
        borderColor: greys(theme)[1000],
        borderWidth: 0.2,
        backgroundColor: greys(theme)[1800],
      }}
      className="absolute bottom-[-4] right-[-4] z-30 rounded-full p-0.5">
      {isCancel ? (
        <Icon name="mdi:cancel" color={greys(theme)[100]} size={10} />
      ) : (
        <Icon
          name={isReceive ? 'fluent:arrow-download-16-filled' : 'fluent:arrow-upload-16-filled'}
          color={greys(theme)[100]}
          size={10}
        />
      )}
    </View>
  );

  /**
   * Profile image component for transaction
   */
  const ProfileImage = (): JSX.Element => (
    <CachedImage
      style={{
        width: 28,
        height: 28,
        borderRadius: 1000,
        borderColor: greys(theme)[1000],
        borderWidth: 0.5,
      }}
      source={{ uri: profilePicture }}
    />
  );

  /**
   * Render transaction icon with appropriate indicators
   */
  const renderExchangeIcon = (): JSX.Element => {
    // For receive transactions
    if (isReceive) {
      if (profilePicture) {
        return (
          <IconContainer>
            <StatusIndicator />
            <ProfileImage />
          </IconContainer>
        );
      } else {
        return (
          <IconContainer>
            <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} />
          </IconContainer>
        );
      }
    }
    // For send transactions
    else {
      if (profilePicture) {
        return (
          <IconContainer>
            <StatusIndicator isCancel={tx.isCancel} />
            <ProfileImage />
          </IconContainer>
        );
      } else if (
        esims
          .map((e: { request: string }) => e.request)
          .filter(Boolean)
          .includes(tx.request)
      ) {
        return (
          <IconContainer>
            <StatusIndicator isCancel={tx.isCancel} />
            <Icon name="fluent:sim-24-filled" color={greys(theme)[100]} />
          </IconContainer>
        );
      } else if (tx.isCancel) {
        return (
          <IconContainer>
            <Icon name="mdi:cancel" color={greys(theme)[100]} />
          </IconContainer>
        );
      } else {
        return (
          <IconContainer>
            <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
          </IconContainer>
        );
      }
    }
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
          {renderExchangeIcon()}

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
