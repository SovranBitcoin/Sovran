import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatCurrency } from 'helper/currency';
import { convertTime } from 'helper/time';
import { greys, shades } from 'helper/colors';

const TransactionComponent = ({ transaction, theme, isReceived }) => {
  const styles = createStyles(theme);

  const gradientColors = isReceived
    ? [greys(theme)[1000], greys(theme)[1200]]
    : [shades[100], shades[300]];

  const arrowBackgroundColor = isReceived ? greys(theme)[1200] : shades[300];

  const formattedAmount =
    transaction.unit &&
    formatCurrency(
      {
        currency: transaction.unit === 'sat' ? 'BTC' : transaction.unit.toUpperCase(),
        value: transaction.amount,
        denomination: transaction.unit === 'sat' ? 'sats' : transaction.unit,
      },
      {
        locale: 'en-US',
        precision: transaction.unit === 'sat' ? 0 : 2,
        currencyDisplay: transaction.unit === 'sat' ? 'name' : 'symbol',
        denomination: transaction.unit === 'sat' ? 'sats' : transaction.unit,
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

const createStyles = (theme: string) =>
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
