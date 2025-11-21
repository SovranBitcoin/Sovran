import React, { useState, useMemo, useCallback } from 'react';
import { ScrollView } from 'react-native';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon, { CurrencyIcon } from 'assets/icons';
import { HStack, VStack, Spacer } from 'components/ui/View';
import { useTheme } from '@/providers/ThemeProvider';

interface MintData {
  mintUrl?: string;
  url?: string;
  name?: string;
  amount?: number;
  unit?: string;
  iconUrl?: string | null;
  mintInfo?: any; // Make this completely flexible
  auditInfo?: any; // Add this for compatibility
  score?: number; // Add for Nostr data
  comment?: string; // Add for Nostr data
  pubkey?: string; // Add for Nostr data
  eventId?: string; // Add for Nostr data
  created_at?: number; // Add for Nostr data
  [key: string]: any;
}

interface MintCurrencySelectorProps<T extends MintData = MintData> {
  mints: T[];
  renderItem: (mint: T, selectedCurrency: string) => React.ReactNode;
  allowedCurrencies?: string[];
  defaultCurrency?: string;
  currencyLabel?: string;
  mintsLabel?: string;
  onCurrencyChange?: (currency: string) => void;
  customEmptyState?: React.ReactNode;
  isLoading?: boolean;
}

export function MintCurrencySelector<T extends MintData = MintData>({
  mints,
  renderItem,
  allowedCurrencies = ['SAT', 'USD', 'EUR', 'GBP'],
  defaultCurrency,
  currencyLabel = 'Send payment in',
  mintsLabel = 'Send from',
  onCurrencyChange,
  customEmptyState,
  isLoading = false,
}: MintCurrencySelectorProps<T>) {
  const { getPrimaryColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);

  // Extract available currencies from mints
  const availableCurrencies = useMemo(() => {
    const units: string[] = [];
    mints.forEach((mint) => {
      if (mint.mintInfo?.nuts?.['4']?.methods) {
        mint.mintInfo.nuts['4'].methods.forEach((method: any) => {
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
    const filtered = uniqueUnits.filter((c) => allowedCurrencies.includes(c));

    // Always include "ALL" option at the beginning
    return ['ALL', ...filtered];
  }, [mints, allowedCurrencies]);

  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    defaultCurrency || availableCurrencies[0] || 'ALL'
  );

  // Filter mints by selected currency
  const filteredMints = useMemo(() => {
    // If "ALL" is selected, show all mints
    if (selectedCurrency === 'ALL') {
      return mints;
    }

    return mints.filter((mint) => {
      if (!mint.mintInfo?.nuts?.['4']?.methods) {
        // If no nuts data, default to SAT for backward compatibility
        return selectedCurrency === 'SAT';
      }

      // Check if this mint supports the selected currency
      return mint.mintInfo.nuts['4'].methods.some(
        (method: any) => method.unit?.toUpperCase() === selectedCurrency
      );
    });
  }, [mints, selectedCurrency]);

  const handleCurrencyChange = useCallback(
    (currency: string) => {
      setSelectedCurrency(currency);
      onCurrencyChange?.(currency);
    },
    [onCurrencyChange]
  );

  return (
    <VStack flex={1}>
      {/* Currency Selector */}
      <VStack>
        <Text
          size={18}
          bold
          overpass
          className="text-primary-0"
          style={{
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
                  backgroundColor:
                    selectedCurrency === currency ? primaryColor700 : primaryColor900,
                }}
                onPress={() => handleCurrencyChange(currency)}>
                <HStack align="center" justify="flex-start" gap={8}>
                  {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? (
                    <Icon
                      name={`circle-flags:${currency === 'USD' ? 'us' : currency === 'EUR' ? 'eu' : 'gb'}`}
                      size={32}
                    />
                  ) : currency === 'ALL' ? (
                    <Icon name="clarity:internet-of-things-solid" color={primaryColor0} size={32} />
                  ) : (
                    <CurrencyIcon width={32} currency={currency.toLowerCase()} />
                  )}
                  <Text size={14} bold overpass className="text-primary-0">
                    {currency === 'SAT' ? 'BTC' : currency === 'ALL' ? 'ALL' : currency}
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
          size={18}
          bold
          overpass
          className="text-primary-0"
          style={{
            marginBottom: 4,
          }}>
          {mintsLabel}
        </Text>
        <VStack>
          {isLoading && mints.length === 0 ? (
            customEmptyState || null
          ) : filteredMints.length === 0 ? (
            <Text style={{ color: primaryColor0, textAlign: 'center', marginTop: 20 }}>
              {selectedCurrency === 'ALL'
                ? 'No mints available'
                : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
            </Text>
          ) : (
            filteredMints.map((mint) => (
              <React.Fragment key={mint.mintUrl || mint.url || Math.random()}>
                {renderItem(mint, selectedCurrency)}
              </React.Fragment>
            ))
          )}
        </VStack>
      </VStack>
    </VStack>
  );
}
