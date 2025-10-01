import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { TouchableOpacity, ScrollView } from 'react-native';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { FlagIcon, CurrencyIcon } from 'assets/icons';
import { useMintManagement } from 'hooks/coco';
import { memoizedGetTheme } from 'helper/redux/settings';
import { View, HStack } from 'components/ui/View';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

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

const SUPPORTED_CURRENCIES = ['SAT', 'USD', 'EUR', 'GBP'];

const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  selectedCurrency,
  onCurrencyChange,
}) => {
  const theme = useSelector(memoizedGetTheme);

  const { getBalances } = useMintManagement();
  const [multipleBalances, setMultipleBalances] = useState<BalanceItem[]>([]);

  // Load balances from Coco
  useEffect(() => {
    const loadBalances = async () => {
      try {
        const balanceData = await getBalances();

        // Convert Coco balance format to the expected format
        const formattedBalances = Object.entries(balanceData).map(([mintUrl, amount]) => ({
          mintUrl,
          amount: amount || 0,
          unit: 'sat', // Default unit
        }));

        setMultipleBalances(formattedBalances);
      } catch (error) {
        console.error('Failed to load balances:', error);
        setMultipleBalances([]);
      }
    };

    loadBalances();
  }, [getBalances]);

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
            <TouchableOpacity key={currency} onPress={() => handleCurrencyChange(currency)}>
              <LinearGradient
                key={currency}
                colors={
                  selectedCurrency === currency
                    ? ([
                        opacity(theme.shades[200], 0.88),
                        opacity(theme.shades[200], 0.88),
                        opacity(theme.shades[300], 0.88),
                        opacity(theme.shades[200], 0.88),
                        opacity(theme.shades[300], 0.88),
                      ] as const)
                    : [opacity(theme.shades[200], 0), opacity(theme.shades[200], 0)]
                }
                style={[
                  {
                    borderWidth: 0.2,
                    borderColor: greys(theme)[600],
                  },

                  {
                    marginRight: 8,
                    borderRadius: 8,
                    padding: 0.5,
                    backgroundColor:
                      selectedCurrency === currency ? greys(theme)[900] : greys(theme)[700],
                  },
                ]}>
                <View
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: isSelected ? greys(theme)[700] : greys(theme)[950],
                    borderWidth: 0.5,
                    borderColor: greys(theme)[700],
                    minWidth: 100,
                  }}>
                  <HStack align="center" gap={8} style={{ width: 36 }}>
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
                  </HStack>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default React.memo(CurrencySelector);
