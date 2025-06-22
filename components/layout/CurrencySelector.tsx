import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text } from 'components/common/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { FlagIcon, CurrencyIcon } from 'assets/icons';
import { memoizedGetAllBalancesMultipleCurrencies } from 'helper/redux/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { isProduction } from 'helper/version';

// Define interface for balance items
interface BalanceItem {
  unit?: string;
  // Add other properties as needed
}

interface CurrencyItem {
  code: string;
  country?: 'US' | 'EU' | 'GB';
}

interface CurrencySelectorProps {
  selectedCurrency: string;
  onCurrencyChange: (currency: string) => void;
}

const SUPPORTED_CURRENCIES = isProduction ? ['SAT'] : ['SAT'];

const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  selectedCurrency,
  onCurrencyChange,
}) => {
  const theme = useSelector(memoizedGetTheme);

  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies) as BalanceItem[];

  const currencies = useMemo(() => {
    const uniqueCurrencies = [
      ...new Set(
        multipleBalances
          .map((balance) =>
            typeof balance.unit === 'string' ? balance.unit.toUpperCase() : undefined
          )
          .filter((unit): unit is string => typeof unit === 'string')
      ),
    ].filter((currency) => SUPPORTED_CURRENCIES.includes(currency));

    return uniqueCurrencies;
  }, [multipleBalances]);

  const handleCurrencyChange = useCallback(
    (currency: string) => {
      onCurrencyChange(currency);
    },
    [onCurrencyChange]
  );

  const getCurrencyItem = useCallback((code: string): CurrencyItem => {
    if (['USD', 'EUR', 'GBP'].includes(code)) {
      return {
        code,
        country: code === 'USD' ? 'US' : code === 'EUR' ? 'EU' : ('GB' as const),
      };
    }
    return { code };
  }, []);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-grow">
        {currencies.map((currency) => {
          const currencyItem = getCurrencyItem(currency);
          const isSelected = selectedCurrency === currency;

          return (
            <TouchableOpacity
              key={currency}
              onPress={() => handleCurrencyChange(currency)}
              style={{
                marginRight: 12,
                padding: 12,
                borderRadius: 8,
                backgroundColor: isSelected ? greys(theme)[1500] : greys(theme)[2300],
                borderWidth: 0.5,
                borderColor: greys(theme)[1500],
                minWidth: 100,
              }}>
              <View style={styles.currencyContent}>
                {currencyItem.country ? (
                  <FlagIcon country={currencyItem.country} height={32} width={32} />
                ) : (
                  <CurrencyIcon currency={currency.toLowerCase()} />
                )}
                <Text
                  style={{
                    color: greys(theme)[0],
                    fontSize: 14,
                    fontFamily: 'OverpassBold',
                  }}>
                  {currency}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// Keep only the styles that don't depend on theme
const styles = StyleSheet.create({
  currencyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    width: 36,
    height: 36,
  },
});

export default React.memo(CurrencySelector);
