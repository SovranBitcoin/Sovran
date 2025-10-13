import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { ScrollView } from 'react-native';
import { Text } from 'components/ui/Text';
import Icon, { CurrencyIcon } from 'assets/icons';
import { useMintManagement } from 'hooks/coco';
import { useTheme } from 'providers/ThemeProvider';
import { View, HStack } from 'components/ui/View';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';

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
  const { getPrimaryColor, getShadeColor } = useTheme();

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
                        opacity(getShadeColor('200'), 0.88),
                        opacity(getShadeColor('200'), 0.88),
                        opacity(getShadeColor('300'), 0.88),
                        opacity(getShadeColor('200'), 0.88),
                        opacity(getShadeColor('300'), 0.88),
                      ] as const)
                    : [opacity(getShadeColor('200'), 0), opacity(getShadeColor('200'), 0)]
                }
                style={[
                  {
                    borderWidth: 0.2,
                    borderColor: getPrimaryColor('600'),
                  },

                  {
                    marginRight: 8,
                    borderRadius: 8,
                    padding: 0.5,
                    backgroundColor:
                      selectedCurrency === currency
                        ? getPrimaryColor('900')
                        : getPrimaryColor('700'),
                  },
                ]}>
                <View
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: isSelected ? getPrimaryColor('700') : getPrimaryColor('950'),
                    borderWidth: 0.5,
                    borderColor: getPrimaryColor('700'),
                    minWidth: 100,
                  }}>
                  <HStack align="center" gap={8} style={{ width: 36 }}>
                    {currencyItem.country ? (
                      <Icon name={`circle-flags:${currencyItem.country.toLowerCase()}`} size={32} />
                    ) : (
                      <CurrencyIcon currency={currency.toLowerCase()} />
                    )}
                    <Text
                      size={14}
                      bold
                      overpass
                      style={{
                        color: getPrimaryColor('0'),
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
