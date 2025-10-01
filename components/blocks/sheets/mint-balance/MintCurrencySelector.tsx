import React, { useState, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import { HStack, VStack, Spacer } from 'components/ui/View';
import { greys, Theme } from 'helper/colors';

interface MintData {
  mintUrl: string;
  name: string;
  amount: number;
  unit: string;
  iconUrl: string | null;
  mintInfo?: {
    nuts?: {
      '4'?: {
        methods?: { unit?: string }[];
      };
    };
  };
  [key: string]: any;
}

interface MintCurrencySelectorProps<T extends MintData = MintData> {
  mints: T[];
  theme: Theme;
  renderItem: (mint: T, selectedCurrency: string) => React.ReactNode;
  allowedCurrencies?: string[];
  defaultCurrency?: string;
  currencyLabel?: string;
  mintsLabel?: string;
  onCurrencyChange?: (currency: string) => void;
}

export function MintCurrencySelector<T extends MintData = MintData>({
  mints,
  theme,
  renderItem,
  allowedCurrencies = ['SAT', 'USD', 'EUR', 'GBP'],
  defaultCurrency,
  currencyLabel = 'Send payment in',
  mintsLabel = 'Send from',
  onCurrencyChange,
}: MintCurrencySelectorProps<T>) {
  const g = greys(theme);

  // Extract available currencies from mints
  const availableCurrencies = useMemo(() => {
    const units: string[] = [];
    mints.forEach((mint) => {
      if (mint.mintInfo?.nuts?.['4']?.methods) {
        mint.mintInfo.nuts['4'].methods.forEach((method) => {
          if (method.unit) {
            units.push(method.unit.toUpperCase());
          }
        });
      } else {
        // Default to SAT if no nuts data
        units.push('SAT');
      }
    });
    const uniqueUnits = [...new Set(units)];
    return uniqueUnits.filter((c) => allowedCurrencies.includes(c));
  }, [mints, allowedCurrencies]);

  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    defaultCurrency || availableCurrencies[0] || 'SAT'
  );

  // Filter mints by selected currency
  const filteredMints = useMemo(() => {
    return mints.filter((mint) => {
      if (!mint.mintInfo?.nuts?.['4']?.methods) {
        // If no nuts data, default to SAT for backward compatibility
        return selectedCurrency === 'SAT';
      }

      // Check if this mint supports the selected currency
      return mint.mintInfo.nuts['4'].methods.some(
        (method) => method.unit?.toUpperCase() === selectedCurrency
      );
    });
  }, [mints, selectedCurrency]);

  const handleCurrencyChange = (currency: string) => {
    setSelectedCurrency(currency);
    onCurrencyChange?.(currency);
  };

  return (
    <VStack flex={1}>
      {/* Currency Selector */}
      <VStack>
        <Text
          style={{
            color: g[0],
            fontSize: 18,
            fontWeight: '600',
            marginBottom: 4,
          }}>
          {currencyLabel}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1 }}>
          <HStack gap={8}>
            {availableCurrencies.map((currency) => (
              <TouchableOpacity
                key={currency}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 8,
                  minWidth: 100,
                  backgroundColor: selectedCurrency === currency ? g[700] : g[900],
                }}
                onPress={() => handleCurrencyChange(currency)}>
                <HStack align="center" justify="flex-start" gap={8}>
                  {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? (
                    <FlagIcon
                      country={currency === 'USD' ? 'US' : currency === 'EUR' ? 'EU' : 'GB'}
                      height={32}
                      width={32}
                    />
                  ) : (
                    <CurrencyIcon currency={currency.toLowerCase()} />
                  )}
                  <Text style={{ color: g[0], fontSize: 14, fontWeight: 'bold' }}>
                    {currency === 'SAT' ? 'BTC' : currency}
                  </Text>
                </HStack>
              </TouchableOpacity>
            ))}
          </HStack>
        </ScrollView>
      </VStack>

      <Spacer size={16} />

      {/* Mints List */}
      <VStack>
        <Text
          style={{
            color: g[0],
            fontSize: 18,
            fontWeight: '600',
            marginBottom: 4,
          }}>
          {mintsLabel}
        </Text>
        <VStack>
          {filteredMints.length === 0 ? (
            <Text style={{ color: g[400], textAlign: 'center', marginTop: 20 }}>
              No mints available for {selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}
            </Text>
          ) : (
            filteredMints.map((mint) => (
              <React.Fragment key={mint.mintUrl}>
                {renderItem(mint, selectedCurrency)}
              </React.Fragment>
            ))
          )}
        </VStack>
      </VStack>
    </VStack>
  );
}
