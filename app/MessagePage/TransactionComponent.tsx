import React from 'react';
import { View, Text, StyleSheet, ColorValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CurrencyCode, Denomination, formatCurrency } from 'helper/currency';
import { convertTime } from 'helper/time';
import { greys, Theme } from 'helper/colors';
import { TransactionData } from 'helper/redux/cashu';

const TransactionComponent = ({
  transaction,
  theme,
  isReceived,
}: {
  transaction: TransactionData;
  theme: Theme;
  isReceived: boolean;
}) => {
  const styles = createStyles(theme);

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [greys(theme)[500], greys(theme)[500]]
    : [theme.shades[200], theme.shades[300]];

  const arrowBackgroundColor = isReceived ? greys(theme)[500] : theme.shades[300];

  const formattedAmount =
    transaction.unit &&
    formatCurrency(
      {
        currency:
          transaction.unit === 'sat' ? 'BTC' : (transaction.unit.toUpperCase() as CurrencyCode),
        value: transaction.amount,
        denomination: transaction.unit === 'sat' ? 'sats' : (transaction.unit as Denomination),
      },
      {
        locale: 'en-US',
        precision: transaction.unit === 'sat' ? 0 : 2,
        currencyDisplay: transaction.unit === 'sat' ? 'name' : 'symbol',
        denomination: transaction.unit === 'sat' ? 'sats' : (transaction.unit as Denomination),
      }
    );

  return (
    <View
      style={[styles.transactionWrapper, { alignSelf: isReceived ? 'flex-start' : 'flex-end' }]}>
      <View
        style={[
          styles.arrow,
          {
            backgroundColor: arrowBackgroundColor,
            left: isReceived ? 16 : 'auto',
            right: isReceived ? 'auto' : 16,
          },
        ]}
      />
      <LinearGradient colors={gradientColors} style={[styles.transactionContainer]}>
        <View style={styles.transactionTypeContainer}>
          <Text style={styles.transactionTypeText}>{isReceived ? 'You received' : 'You sent'}</Text>
        </View>
        <Text style={styles.transactionText}>{formattedAmount}</Text>
        <Text style={styles.timestamp}>
          {transaction?.date ? convertTime(new Date(transaction.date)) : null}
        </Text>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    transactionWrapper: {
      marginVertical: 8,
      position: 'relative',
      backgroundColor: 'transparent',
    },
    transactionContainer: {
      padding: 16,
      borderRadius: 16,
      maxWidth: '75%',
    },
    arrow: {
      position: 'absolute',
      bottom: -4,
      width: 8,
      height: 8,
      transform: [{ rotate: '45deg' }],
    },
    transactionTypeContainer: {
      backgroundColor: 'rgba(0,0,0,0.25)',
      padding: 4,
      marginBottom: 4,
      borderRadius: 16,
    },
    transactionTypeText: {
      fontFamily: 'OverpassBold',
      fontSize: 14,
      textAlign: 'center',
      color: greys(theme)[0],
    },
    transactionText: {
      fontFamily: 'OverpassHeavy',
      fontSize: 16,
      marginBottom: 8,
      color: greys(theme)[0],
    },
    timestamp: {
      color: greys(theme)[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
      textAlign: 'right',
    },
  });

export default TransactionComponent;
