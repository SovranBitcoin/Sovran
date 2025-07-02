import React, { useState, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetAllBalancesMultipleCurrencies } from 'helper/redux/cashu/selectors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { Text } from 'components/common/Text';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import Wrapper from '../../wrapper';
import _ from 'lodash';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import Image from 'components/common/Image';
import { formatCurrency } from 'helper/currency';

interface MintItemProps {
  mint: { id: string; name: string; iconUrl: string | null };
  balance: { amount: number; unit: string };
  selectedCurrency: string;
  theme: string;
}

const MintItem: React.FC<MintItemProps> = ({ mint, balance, selectedCurrency, theme }) => {
  const styles = createStyles(theme);
  const formattedBalance = formatCurrency(
    {
      currency: selectedCurrency === 'SAT' ? 'BTC' : (selectedCurrency as 'USD' | 'EUR' | 'GBP'),
      value: balance.amount,
      denomination: (selectedCurrency.toLowerCase() === 'sat' ? 'sats' : selectedCurrency.toLowerCase()) as
        | 'btc'
        | 'sats'
        | 'usd'
        | 'eur'
        | 'gbp',
    },
    { locale: 'en-US', precision: selectedCurrency === 'SAT' ? 0 : 2, currencyDisplay: selectedCurrency === 'SAT' ? 'name' : 'symbol' }
  );
  return (
    <View style={[styles.mintItem, balance.amount === 0 && styles.zeroBalance]}>
      {mint.iconUrl ? <Image source={{ uri: mint.iconUrl }} style={styles.mintIcon} /> : <Image style={styles.mintIcon} />}
      <View style={styles.mintDetails}>
        <Text style={styles.mintName}>{mint.name}</Text>
        <Text style={styles.mintBalance}>{formattedBalance}</Text>
      </View>
    </View>
  );
};

const ListRoute = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const balances = useSelector(memoizedGetAllBalancesMultipleCurrencies);

  const currencies: string[] = _.uniq(balances.map((b) => b.unit?.toUpperCase())).filter(Boolean);

  const [selectedCurrency, setSelectedCurrency] = useState<string>((currencies[0] || 'SAT') as string);

  const filteredMints = useMemo(() => {
    return balances
      .filter((b) => b.unit?.toUpperCase() === selectedCurrency)
      .sort((a, b) => b.amount - a.amount);
  }, [balances, selectedCurrency]);

  const displayCurrency = (c: string) => (c === 'SAT' ? 'BTC' : c);

  return (
    <Wrapper buttons={null}>
      <View>
        <Text weight="bold" style={styles.sectionHeader}>
          Send payment in
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyScroll}>
          {currencies.map((currency) => (
            <LinearGradient
              key={currency}
              colors={
                selectedCurrency === currency
                  ? [
                      opacity(greys(theme)[200], 0.88),
                      opacity(greys(theme)[200], 0.88),
                      opacity(greys(theme)[300], 0.88),
                      opacity(greys(theme)[200], 0.88),
                      opacity(greys(theme)[300], 0.88),
                    ]
                  : [opacity(greys(theme)[200], 0), opacity(greys(theme)[200], 0)]
              }
              style={[styles.currencyButton, { marginRight: 8, borderRadius: 8, padding: 1, backgroundColor: greys(theme)[900] }]}
            >
              <TouchableOpacity
                style={[styles.currencyButton, selectedCurrency === currency && styles.selectedCurrencyButton]}
                onPress={() => setSelectedCurrency(currency)}
              >
                <View style={styles.currencyContent}>
                  {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? (
                    <FlagIcon country={currency === 'USD' ? 'US' : currency === 'EUR' ? 'EU' : 'GB'} height={32} width={32} />
                  ) : (
                    <CurrencyIcon currency={currency.toLowerCase()} />
                  )}
                  <Text style={styles.currencyText}>{displayCurrency(currency)}</Text>
                </View>
              </TouchableOpacity>
            </LinearGradient>
          ))}
        </ScrollView>

        <Text weight="bold" style={[styles.sectionHeader, { marginTop: 24 }]}>Send from</Text>
        <View style={styles.mintScroll}>
          {filteredMints.map((mint) => (
            <MintItem
              key={mint.mintUrl}
              mint={{
                id: mint.mintUrl,
                name: mint.mintUrl.replace('https://', '').split('/')[0],
                iconUrl: mint.iconUrl,
              }}
              balance={{ amount: mint.amount, unit: mint.unit }}
              selectedCurrency={selectedCurrency}
              theme={theme}
            />
          ))}
        </View>
      </View>
    </Wrapper>
  );
};

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
      backgroundColor: greys(theme)[700],
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
      backgroundColor: greys(theme)[800],
      marginBottom: 8,
    },
    zeroBalance: {
      opacity: 0.5,
    },
    mintIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: greys(theme)[200],
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
      color: greys(theme)[200],
      fontSize: 14,
    },
  });

export default ListRoute;
