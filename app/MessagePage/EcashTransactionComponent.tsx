import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatCurrency } from 'helper/currency';
import { convertTime } from 'helper/time';
import { greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';

interface Props {
  transaction: any;
  theme: string;
  isReceived: boolean;
}

const EcashTransactionComponent = ({ transaction, theme, isReceived }: Props) => {
  const styles = createStyles(theme, isReceived);

  const gradientColors = isReceived
    ? [greys(theme)[1000], greys(theme)[1200]]
    : [shades[100], shades[300]];

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
    <View style={[styles.wrapper, { alignSelf: isReceived ? 'flex-start' : 'flex-end' }]}>
      <View
        style={[
          styles.arrow,
          {
            backgroundColor: isReceived ? greys(theme)[1200] : shades[300],
            left: isReceived ? 16 : 'auto',
            right: isReceived ? 'auto' : 16,
          },
        ]}
      />
      <LinearGradient colors={gradientColors} style={styles.container}>
        <Text style={styles.mintText}>{transaction.mintUrl}</Text>
        <View style={styles.footer}>
          <View>
            <Text style={styles.amountText}>{formattedAmount}</Text>
            {transaction.memo && <Text style={styles.memoText}>{transaction.memo}</Text>}
          </View>
        </View>
        <Text style={styles.timestamp}>
          {transaction?.date ? convertTime(new Date(transaction.date)) : null}
        </Text>
      </LinearGradient>
    </View>
  );
};

const createStyles = (theme: string, isReceived: boolean) =>
  StyleSheet.create({
    wrapper: {
      marginVertical: 8,
      position: 'relative',
      backgroundColor: 'transparent',
      width: '100%',
    },
    container: {
      padding: 16,
      borderRadius: 16,
      width: '100%',
    },
    arrow: {
      position: 'absolute',
      bottom: -4,
      width: 8,
      height: 8,
      transform: [{ rotate: '45deg' }],
    },
    amountText: {
      fontFamily: 'OverpassHeavy',
      fontSize: 24,
      color: greys(theme)[0],
      marginBottom: 0,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    memoText: {
      fontFamily: 'OverpassRegular',
      fontSize: 12,
      color: greys(theme)[0],
      backgroundColor: opacity(greys(theme)[0], 0.1),
      padding: 16,
      borderRadius: 8,
    },
    mintText: {
      fontFamily: 'OverpassBold',
      fontSize: 12,
      color: greys(theme)[0],
      opacity: 0.75,
    },
    timestamp: {
      color: greys(theme)[0],
      opacity: 0.75,
      fontFamily: 'OverpassBold',
      fontSize: 12,
      textAlign: 'right',
      marginTop: 8,
    },
  });

export default EcashTransactionComponent;
