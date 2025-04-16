import React from 'react';
import { Text, UntranslatedText, View } from 'components/common/Themed';
import { useMemo } from 'react';
import { useNavigation } from 'expo-router';
import { formatCurrency } from 'helper/currency';
import Icon, { LightningUnit } from 'assets/icons';
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
import { memoizedGetTransactionByMatcher } from 'helper/redux/cashu';
import _ from 'lodash';
import { getRawExpiry } from '../cashu';

export function Transaction({ tx, transactions, account }) {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const { currentProfile, profiles, search } = useNostr();
  const { esims } = useEsims();
  const { settings } = useSettings();

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

  // Find if this is a newest transaction (to show loading)
  const newestEcashTx = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) => {
        const ecashTransactions = txs.filter(
          (tx) => tx.transactionType === 'send' && tx.type === 'ecash' && !tx.paid
        );
        return _.maxBy(ecashTransactions, 'date');
      },
    })
  );

  const newestLightningTx = useSelector(
    memoizedGetTransactionByMatcher({
      profileId: currentProfile.id,
      matcher: (txs) =>
        _.maxBy(
          _.filter(
            txs,
            (tx) =>
              tx.type === 'lightning' &&
              !tx.paid &&
              tx.transactionType === 'receive' &&
              tx.request &&
              new Date() < getRawExpiry({ pr: tx.request }) // Check if not expired
          ),
          'date'
        ),
    })
  );

  const showLoading = _.isEqual(tx, newestEcashTx) || _.isEqual(tx, newestLightningTx);

  // Get profile picture from nostr data
  const profilePicture =
    search?.find((s) => s?.pubkey === tx?.nostr?.pubkey)?.profile?.picture ||
    profiles?.find((p) => p?.pubkey === tx?.nostr?.pubkey)?.picture ||
    search?.find((s) => s?.pubkey === tx?.nostr?.pubkey)?.profile?.image ||
    profiles?.find((p) => p?.pubkey === tx?.nostr?.pubkey)?.image;

  // Handle navigation when transaction is pressed
  const handlePress = () => {
    const isPaid = tx.paid;

    if (tx.request && !isPaid) {
      navigation.navigate('lightningReceiveConfirmation', {
        unit: tx.unit,
        request: tx.request,
        amount: tx.amount,
        transaction: JSON.stringify(tx),
        unified_request: tx.unified_request,
        payment_request: tx.payment_request,
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

  // Format transaction direction text
  const getTransactionDirection = () => {
    if (isBuyTransaction) {
      const from =
        relatedTransaction.unit === 'sat' ? 'BTC' : relatedTransaction.unit.toUpperCase();
      const to = tx.unit === 'sat' ? 'BTC' : tx.unit.toUpperCase();
      return `${from} → ${to}`.toUpperCase();
    } else if (isSellTransaction) {
      const from = tx.unit === 'sat' ? 'BTC' : tx.unit.toUpperCase();
      const to = relatedTransaction.unit === 'sat' ? 'BTC' : relatedTransaction.unit.toUpperCase();
      return `${from} → ${to}`.toUpperCase();
    }
    return (
      tx.transactionType[0].toUpperCase() + tx.transactionType.slice(1) ||
      tx?.from ||
      tx?.to ||
      truncateMiddle(tx.txid || tx.request || tx.token, 3) ||
      'Unknown'
    );
  };

  // Render transaction icon with appropriate indicators
  const renderExchangeIcon = () => {
    const IconContainer = ({ children }) => (
      <View className="relative h-7 w-7 bg-transparent">{children}</View>
    );

    const StatusIndicator = ({ isCancel }) => (
      <View className="absolute bottom-[-4] right-[-4] z-30 z-30 h-4 w-4 rounded-full border border-gray-600 bg-gray-800 p-0.5">
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

    const ProfileImage = () => (
      <CachedImage
        style={{
          width: 28,
          height: 28,
          borderRadius: 1000,
          borderColor: greys(theme)[1300],
          borderWidth: 0.2,
        }}
        source={{ uri: profilePicture }}
      />
    );

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
          .map((e) => e.request)
          .filter((a) => a)
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

  // Format amount display with appropriate currency formatting
  const renderAmountDetails = () => {
    const sign = isSend ? '-' : isReceive ? '+' : '';
    const precision = tx.unit === 'sat' ? (settings.display_btc === 0 ? 8 : 0) : 2;

    const currencyDisplay = settings.display_btc === 1 && tx.unit === 'sat' ? 'none' : 'name';

    const denomination =
      tx.unit === 'sat' ? (settings.display_btc === 0 ? 'btc' : 'sats') : tx.unit;

    const formatAmount = (transaction, options = {}) => {
      if (!transaction?.amount) return null;

      return formatCurrency(
        {
          currency: transaction.unit === 'sat' ? 'BTC' : transaction.unit.toUpperCase(),
          value: Math.abs(transaction.amount),
          denomination: transaction.unit === 'sat' ? 'sats' : transaction.unit,
        },
        {
          locale: 'en-US',
          precision:
            options.precision !== undefined
              ? options.precision
              : transaction.unit === 'sat'
                ? 0
                : 2,
          currencyDisplay: options.currencyDisplay || 'name',
          denomination:
            options.denomination || (transaction.unit === 'sat' ? 'sats' : transaction.unit),
        }
      );
    };

    const amount = formatAmount(tx, {
      precision,
      currencyDisplay,
      denomination,
    });
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
          <UntranslatedText
            style={[
              {
                fontFamily: 'OverpassBold',
                fontSize: 14,
                color: greys(theme)[0],
                margin: 0,
                fontWeight: 'bold',
                alignSelf: 'flex-end',
                textShadowColor: opacity(greys(theme)[0], 0.5),
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 1,
              },
              {
                color: isSend ? reds[300] : greens[300],
              },
            ]}>
            {amount}
          </UntranslatedText>

          {settings.display_btc === 1 && tx.unit === 'sat' && (
            <LightningUnit width={'10'} height="10" color={isSend ? reds[300] : greens[300]} />
          )}
        </View>
        {relatedAmount && (
          <View className="flex flex-row items-center bg-transparent">
            <UntranslatedText
              style={[
                !isSend
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
                    },
                {
                  fontSize: 12,
                },
              ]}>
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

  const getFormattedDate = () => {
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
                    currency: tx.unit === 'sat' ? 'BTC' : tx.unit.toUpperCase(),
                    value: Math.abs(tx.amount),
                    denomination: tx.unit === 'sat' ? 'sats' : tx.unit,
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
