import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import {
  ScrollView,
  useSheetRef,
  useSheetPayload,
} from 'react-native-actions-sheet';
import { useDispatch, useSelector } from 'react-redux';
import { memoizedGetAllBalancesMultipleCurrencies } from 'helper/redux/cashu/selectors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { Text } from 'components/common/Text';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { CurrencyIcon, FlagIcon } from 'assets/icons';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/common/ButtonHandler';
import _ from 'lodash';
import { GradientBorderView } from '@good-react-native/gradient-border';
import opacity from 'hex-color-opacity';
import Image from 'components/common/Image';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { showMessage } from 'helper/popup/popups';
import { setSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { useTypedNavigation } from 'helper/navigation';

interface MintItemProps {
  mint: { id: string; name: string; iconUrl: string | null };
  balance: { amount: number; unit: string };
  theme: string;
  onPress: () => void;
  isLoading: boolean;
  globalLoading: boolean;
}

const MintItem: React.FC<MintItemProps> = ({
  mint,
  balance,
  theme,
  onPress,
  isLoading,
  globalLoading,
}) => {
  const styles = createStyles(theme);
  return (
    <TouchableOpacity onPress={onPress} disabled={globalLoading}>
      <View blur style={[styles.mintItem, balance.amount === 0 && styles.zeroBalance]}>
        {mint.iconUrl ? (
          <Image source={{ uri: mint.iconUrl }} style={styles.mintIcon} />
        ) : (
          <Image style={styles.mintIcon} />
        )}
        <View style={styles.mintDetails}>
          <Text style={styles.mintName}>{mint.name}</Text>
          <Text style={styles.mintBalance}>
            <AmountFormatter size={14} amount={balance.amount} unit={balance.unit} />
          </Text>
        </View>
        <View style={{ width: 16 }}>
          {isLoading && <ActivityIndicator size="small" color={greys(theme)[0]} />}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const ListRoute = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const navigation = useTypedNavigation();

  const balances = useSelector(memoizedGetAllBalancesMultipleCurrencies);
  const dispatch = useDispatch();
  const profileId = useSelector(memoizedGetCurrentProfile).id;

  const currencies: string[] = _.uniq(
    balances.map((b) => b.unit?.toUpperCase())
  ).filter(Boolean);

  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    (currencies[0] || 'SAT') as string
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const filteredMints = useMemo(() => {
    return balances
      .filter((b) => b.unit?.toUpperCase() === selectedCurrency)
      .sort((a, b) => b.amount - a.amount);
  }, [balances, selectedCurrency]);

  const handleMintSelect = async (mintUrl: string) => {
    const mint = filteredMints.find((m) => m.mintUrl === mintUrl);
    if (!mint) {
      sheetRef.current?.hide();
      return;
    }

    if (mint.amount === 0) {
      showMessage('insufficient_balance', {
        amount: mint.amount,
        unit: mint.unit,
        fee: 0,
      });
      return;
    }

    setLoadingId(mint.mintUrl);
    dispatch(setSelectedMint({ profileId, mintUrl: mint.mintUrl }));
    if (payload?.navigate) {
      await new Promise((resolve) => setTimeout(resolve, 300));

      navigation.navigate('currency', {
        to: 'ecashSendConfirmation',
        unit: mint.unit.toLowerCase(),
        type: payload?.accountType,
        accountIndex: payload?.accountIndex,
      });
    }

    sheetRef.current?.hide({
      id: mint.mintUrl,
      name: mint.mintUrl.replace('https://', '').split('/')[0],
      iconUrl: mint.iconUrl,
      unit: mint.unit,
    });

    setLoadingId(null);
  };

  const displayCurrency = (c: string) => (c === 'SAT' ? 'BTC' : c);

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: () => sheetRef.current?.hide(),
            },
          ]}
        />
      }>
      <View>
        <Text weight="bold" style={styles.sectionHeader}>
          Send payment in
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyScroll}>
          {currencies.map((currency) => (
            <TouchableOpacity key={currency} onPress={() => setSelectedCurrency(currency)}>
              <GradientBorderView
                gradientProps={{
                  colors:
                    selectedCurrency === currency
                      ? [
                          opacity(greys(theme)[200], 0.88),
                          opacity(greys(theme)[300], 0.88),
                          opacity(greys(theme)[200], 0.88),
                          opacity(greys(theme)[300], 0.88),
                        ]
                      : [opacity(greys(theme)[200], 0), opacity(greys(theme)[200], 0)],
                }}
                style={{ borderWidth: selectedCurrency === currency ? 1 : 0, borderRadius: 8, marginRight: 8 }}
              >
                <View
                  blur
                  style={[
                    styles.currencyContent,
                    styles.currencyButton,
                    selectedCurrency === currency && styles.selectedCurrencyButton,
                  ]}
                >
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
              </GradientBorderView>
            </TouchableOpacity>
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
              theme={theme}
              isLoading={loadingId === mint.mintUrl}
              globalLoading={loadingId !== null}
              onPress={() => handleMintSelect(mint.mintUrl)}
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
