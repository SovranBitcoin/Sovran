import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { FlagIcon, CurrencyIcon } from 'assets/icons';
import { memoizedGetAllBalancesMultipleCurrencies } from 'helper/redux/cashu';

const CurrencySelector = ({
  selectedCurrency,
  onCurrencyChange,
}: {
  selectedCurrency: string;
  onCurrencyChange: (currency: string) => void;
}) => {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);

  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);

  const currencies = [...new Set(multipleBalances.map((b) => b.unit?.toUpperCase()))];

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyScroll}>
        {currencies.map((currency) => (
          <TouchableOpacity
            key={currency}
            style={[
              styles.currencyButton,
              selectedCurrency === currency && styles.selectedCurrencyButton,
            ]}
            onPress={() => onCurrencyChange(currency)}>
            <View style={styles.currencyContent}>
              {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? (
                <FlagIcon
                  country={currency === 'USD' ? 'US' : currency === 'EUR' ? 'EU' : 'GB'}
                  height={32}
                  width={32}
                />
              ) : (
                <CurrencyIcon currency={currency.toLowerCase()} />
              )}
              <Text style={styles.currencyText}>{currency}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    currencyScroll: {
      flexGrow: 1,
    },
    currencyButton: {
      marginRight: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[2300],
      borderWidth: 0.5,
      borderColor: greys(theme)[1500],
      minWidth: 100,
    },
    currencyContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
      width: 36,
      height: 36,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[1500],
      borderWidth: 0.5,
    },
    currencyText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontFamily: 'OverpassBold',
    },
  });

export default CurrencySelector;
