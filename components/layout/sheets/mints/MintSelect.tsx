import React, { useState, useMemo } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSelector } from 'react-redux';
import {
  memoizedGetAllBalancesMultipleCurrencies,
  memoizedGetSelectedMint,
} from 'helper/redux/cashu/selectors';
import Icon, { CheckIcon, CurrencyIcon, FlagIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { Text } from 'components/common/Themed';
import { greys, shades } from 'helper/colors';
import { formatCurrency } from 'helper/currency';
import Image from 'components/common/Image';
import Wrapper from '../wrapper';
import { showMessage } from 'helper/popup/popups';
import { sovran } from '.';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import _ from 'lodash';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { store } from 'helper/redux/store';
import { isProduction } from 'helper/version';

interface SelectedMintDisplayProps {
  onPress?: () => void;
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
  onMintQuoteUpdate?: (meltQuote: string) => void;
  pr?: string;
  unit?: string;
  onUnitUpdate?: (unit: string) => void;
  loading?: boolean;
}

type SupportedCurrency = 'SAT' | 'USD' | 'EUR' | 'GBP';

interface MintState {
  selected: {
    id: string;
    name: string;
    balance: number;
    iconUrl: string | null;
    unit: string;
  } | null;
  loadingId: string | null;
}

interface MintItemProps {
  mint: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
  balance?: {
    amount: number;
    unit: string;
  };
  isSelected: boolean;
  isLoading: boolean;
  globalLoading: boolean;
  selectedCurrency: string;
  theme: string;
  onPress: () => void;
}

const MintItem: React.FC<MintItemProps> = ({
  mint,
  balance,
  isSelected,
  isLoading,
  globalLoading,
  selectedCurrency,
  theme,
  onPress,
}) => {
  const styles = createStyles(theme);

  function handlePress() {
    onPress();
  }

  const formattedBalance = balance
    ? formatCurrency(
        {
          currency:
            selectedCurrency === 'SAT'
              ? 'BTC'
              : (selectedCurrency as 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'NZD' | 'KRW'),
          value: balance.amount,
          denomination: (selectedCurrency.toLowerCase() === 'sat'
            ? 'sats'
            : selectedCurrency.toLowerCase()) as
            | 'btc'
            | 'sats'
            | 'bits'
            | 'finneys'
            | 'usd'
            | 'eur'
            | 'gbp'
            | 'aud'
            | 'cad'
            | 'nzd'
            | 'krw',
        },
        {
          locale: 'en-US',
          precision: selectedCurrency === 'SAT' ? 0 : 2,
          currencyDisplay: selectedCurrency === 'SAT' ? 'name' : 'symbol',
          denomination: (selectedCurrency.toLowerCase() === 'sat'
            ? 'sats'
            : selectedCurrency.toLowerCase()) as
            | 'btc'
            | 'sats'
            | 'bits'
            | 'finneys'
            | 'usd'
            | 'eur'
            | 'gbp'
            | 'aud'
            | 'cad'
            | 'nzd'
            | 'krw',
        }
      )
    : '0';
  const router = useSheetRouter('mint');

  return (
    <LinearGradient
      colors={
        isSelected
          ? [
              opacity(shades[100], 0.88),
              opacity(shades[200], 0.88),
              opacity(shades[300], 0.88),
              opacity(shades[400], 0.88),
              opacity(shades[500], 0.88),
            ]
          : []
      }
      style={[
        {
          padding: 1,
          marginVertical: 4,
          borderRadius: 16,
        },
      ]}>
      <TouchableOpacity
        key={mint.id}
        style={[
          sovran(theme).listItem,
          globalLoading && styles.disabledMintItem,
          {
            backgroundColor: greys(theme)[2100],
            marginVertical: 0,
          },
          isSelected && styles.selectedMintItem,
        ]}
        onPress={handlePress}
        disabled={globalLoading}>
        <View
          style={{
            position: 'relative',
          }}>
          {mint.iconUrl ? (
            <Image source={{ uri: mint.iconUrl }} style={styles.mintIcon} />
          ) : (
            <Image style={styles.mintIcon} />
          )}
          <View
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
            }}>
            {isLoading ? (
              <ActivityIndicator animating size="small" color={greys(theme)[0]} />
            ) : isSelected ? (
              <View style={styles.checkIconContainer}>
                <CheckIcon size={16} color={greys(theme)[0]} />
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.mintDetails}>
          <Text style={styles.mintName}>{mint.name}</Text>
          <Text style={styles.mintBalance}>{formattedBalance}</Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            router?.navigate('mintDetailsPage', {
              mintUrl: mint.id,
            });
          }}>
          <Icon
            style={{
              padding: 8,
              backgroundColor: isSelected
                ? opacity(greys(theme)[2000], 0.5)
                : opacity(greys(theme)[1800], 0.75),
              borderRadius: 10000,
            }}
            name="bx:dots-vertical-rounded"
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </LinearGradient>
  );
};

export function MintSelect({ onMintSelected, unit }: SelectedMintDisplayProps) {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);

  const [mintState, setMintState] = useState<MintState>({
    selected: null,
    loadingId: null,
  });
  const [selectedCurrency, setSelectedCurrency] = useState<SupportedCurrency>(
    (unit?.toUpperCase() || 'SAT') as SupportedCurrency
  );

  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);

  // limit to specified currencies: sat, eur, gbp, usd
  const currencies: SupportedCurrency[] = _.uniq(
    multipleBalances.map((b) => b.unit?.toUpperCase())
  ).filter((c) => (isProduction ? ['SAT'] : ['SAT']).includes(c));

  // Filter mints based on the selected currency
  const filteredMints = useMemo(() => {
    return multipleBalances.filter((mint) => mint.unit?.toUpperCase() === selectedCurrency);
  }, [multipleBalances, selectedCurrency]);

  const handleMintSelection = async (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
    },
    balance: { amount: number; unit: string } | undefined
  ) => {
    if (onMintSelected) {
      setMintState((prev) => ({
        ...prev,
        loadingId: mint.id,
      }));

      try {
        const selectedUnit = selectedCurrency.toLowerCase();
        const finalUnit = (balance?.unit || selectedUnit) as string;
        await onMintSelected(
          {
            ...mint,
            unit: finalUnit.toLowerCase(),
          },
          balance
        );
        setMintState((prev) => ({
          selected: {
            id: mint.id,
            name: mint.name,
            balance: balance?.amount || 0,
            iconUrl: mint.iconUrl,
            unit: finalUnit,
          },
          loadingId: null,
        }));
      } catch (error) {
        setMintState((prev) => ({
          ...prev,
          loadingId: null,
        }));

        showMessage('general_error', {}, { emoji: '🚨' });
      }
    }

    router?.goBack();
  };

  const selectedMint = memoizedGetSelectedMint(store.getState());

  const displayCurrency = (currency: string) => {
    return currency === 'SAT' ? 'BTC' : currency;
  };

  const router = useSheetRouter('mint');
  return (
    <Wrapper
      children={
        <View>
          <Text weight="bold" style={styles.sectionHeader}>
            Send payment in
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.currencyScroll}>
            {currencies.map((currency) => (
              <LinearGradient
                key={currency}
                colors={
                  selectedCurrency === currency
                    ? ([
                        opacity(shades[100], 0.88),
                        opacity(shades[200], 0.88),
                        opacity(shades[300], 0.88),
                        opacity(shades[400], 0.88),
                        opacity(shades[500], 0.88),
                      ] as const)
                    : [opacity(shades[100], 0), opacity(shades[100], 0)]
                }
                style={[
                  styles.currencyButton,
                  sovran(theme).borderSubtle,

                  {
                    marginRight: 8,
                    borderRadius: 8,
                    padding: 1,
                    backgroundColor:
                      selectedCurrency === currency ? greys(theme)[1900] : greys(theme)[2100],
                  },
                ]}>
                <TouchableOpacity
                  style={[
                    styles.currencyButton,
                    selectedCurrency === currency && styles.selectedCurrencyButton,
                    {
                      flex: 1,
                    },
                  ]}
                  onPress={() => setSelectedCurrency(currency)}>
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
                    <Text style={styles.currencyText}>{displayCurrency(currency)}</Text>
                  </View>
                </TouchableOpacity>
              </LinearGradient>
            ))}
          </ScrollView>

          <Text weight="bold" style={[styles.sectionHeader, { marginTop: 24 }]}>
            Send from
          </Text>
          <View style={styles.mintScroll}>
            {filteredMints.map((mint) => {
              return (
                <MintItem
                  key={mint.mintUrl}
                  mint={{
                    id: mint.mintUrl,
                    name: mint.mintUrl.replace('https://', '')?.split('/')?.[0],
                    iconUrl: mint.iconUrl,
                  }}
                  balance={{ amount: mint.amount, unit: mint.unit }}
                  isSelected={selectedMint === mint.mintUrl}
                  isLoading={mintState.loadingId === mint.mintUrl}
                  globalLoading={mintState.loadingId !== null}
                  selectedCurrency={selectedCurrency}
                  theme={theme}
                  onPress={() =>
                    handleMintSelection(
                      {
                        id: mint.mintUrl,
                        name: mint.mintUrl.replace('https://', '')?.split('/')?.[0],
                        iconUrl: null,
                      },
                      { amount: mint.amount, unit: mint.unit }
                    )
                  }
                />
              );
            })}
          </View>
        </View>
      }
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Add mints',
              variant: 'primary',
              onPress: () => {
                router?.navigate('mintAddMore');
              },
              loading: mintState.loadingId !== null,
            },
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: () => {
                router?.goBack();
              },
              loading: mintState.loadingId !== null,
            },
          ]}
        />
      }
    />
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
    },
    currencyScroll: {
      flexGrow: 1,
    },
    currencyButton: {
      padding: 12,
      borderRadius: 8,
      minWidth: 100,
    },
    currencyContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[1500],
    },
    currencyText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontFamily: 'OverpassBold',
    },
    mintScroll: {},
    mintItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 8,
      backgroundColor: greys(theme)[1800],
      marginBottom: 8,
    },
    selectedMintItem: {
      backgroundColor: greys(theme)[1500],
    },
    mintIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: greys(theme)[400],
    },
    mintDetails: {
      flex: 1,
      marginLeft: 12,
      marginRight: 12,
    },
    mintName: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    mintBalance: {
      color: greys(theme)[400],
      fontSize: 14,
    },
    checkIconContainer: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 1000,
      marginLeft: 8,
    },
    disabledMintItem: {
      opacity: 0.5,
    },
  });
