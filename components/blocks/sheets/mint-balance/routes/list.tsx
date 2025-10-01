import React, { useState, useMemo, useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { ScrollView, useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useDispatch, useSelector } from 'react-redux';
import { useMintManagement } from 'hooks/coco';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon, { CurrencyIcon, FlagIcon } from 'assets/icons';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Avatar } from 'components/ui/Avatar';
import { showMessage } from 'helper/popup/popups';
import { setSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { useTypedNavigation } from 'helper/navigation';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { formatCurrency } from 'helper/currency';

interface MintItemProps {
  mint: { id: string; name: string; iconUrl: string | null };
  balance: { amount: number; unit: string };
  theme: Theme;
  onPress: () => void;
  isLoading: boolean;
  globalLoading: boolean;
  requireBalance?: boolean;
  selectedCurrency: string;
  showDetailsButton?: boolean;
  onDetailsPress?: (mintUrl: string) => void;
}

const MintItem: React.FC<MintItemProps> = ({
  mint,
  balance,
  theme,
  onPress,
  isLoading,
  globalLoading,
  requireBalance: _requireBalance = true,
  selectedCurrency,
  showDetailsButton = false,
  onDetailsPress,
}) => {
  const formattedBalance = balance
    ? formatCurrency(
        {
          currency: selectedCurrency === 'SAT' ? 'BTC' : (selectedCurrency as any),
          value: balance.amount,
          denomination:
            selectedCurrency.toLowerCase() === 'sat'
              ? 'sats'
              : (selectedCurrency.toLowerCase() as any),
        },
        {
          locale: 'en-US',
          precision: selectedCurrency === 'SAT' ? 0 : 2,
          currencyDisplay: selectedCurrency === 'SAT' ? 'name' : 'symbol',
          denomination:
            selectedCurrency.toLowerCase() === 'sat'
              ? 'sats'
              : (selectedCurrency.toLowerCase() as any),
        }
      )
    : '0';

  return (
    <TouchableOpacity
      style={{
        padding: 16,
        marginBottom: 4,
        borderRadius: 16,
        backgroundColor: greys(theme)[900],
        opacity: globalLoading ? 0.5 : balance.amount === 0 && _requireBalance ? 0.5 : 1,
      }}
      onPress={onPress}
      disabled={globalLoading}>
      <HStack align="center" gap={12}>
        <View style={{ position: 'relative' }}>
          <Avatar
            picture={mint.iconUrl || undefined}
            size={36}
            variant="mint"
            name={mint.name}
            alt={`${mint.name} mint`}
          />
          <View style={{ position: 'absolute', bottom: -2, right: -2 }}>
            {isLoading && <ActivityIndicator animating size="small" color={greys(theme)[0]} />}
          </View>
        </View>

        <VStack flex={1}>
          <Text style={{ color: greys(theme)[0], fontSize: 16, fontWeight: '500' }}>
            {mint.name}
          </Text>
          <Text style={{ color: greys(theme)[200], fontSize: 14 }}>{formattedBalance}</Text>
        </VStack>

        {showDetailsButton && (
          <TouchableOpacity
            onPress={() => {
              if (onDetailsPress) {
                onDetailsPress(mint.id);
              } else {
                // Navigate to mint details sheet
                import('react-native-actions-sheet').then(({ SheetManager }) => {
                  SheetManager.show('mint', {
                    payload: {
                      initialRoute: 'mintDetailsPage',
                      mintUrl: mint.id,
                    },
                  });
                });
              }
            }}>
            <Icon
              style={{
                padding: 8,
                borderRadius: 1000,
                backgroundColor: `${greys(theme)[800]}BF`,
              }}
              name="bx:dots-vertical-rounded"
            />
          </TouchableOpacity>
        )}
      </HStack>
    </TouchableOpacity>
  );
};

const ListRoute = () => {
  const theme = useSelector(memoizedGetTheme);
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const navigation = useTypedNavigation();

  console.log(payload);

  // Extract configuration from payload
  const showAddMintsButton = payload?.showAddMintsButton ?? false;
  const showDetailsButton = payload?.showDetailsButton ?? false;
  const onAddMintsPress = payload?.onAddMintsPress;
  const onDetailsPress = payload?.onDetailsPress;

  const { getBalances, mints } = useMintManagement();
  const [filteredMints, setFilteredMints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Get currencies from mints (unit is in nuts[4].methods) - same as MintSelect.tsx
  const currencies = useMemo(() => {
    const units: string[] = [];
    mints.forEach((mint) => {
      if (mint.mintInfo?.nuts?.['4']?.methods) {
        mint.mintInfo.nuts['4'].methods.forEach((method: any) => {
          if (method.unit) {
            units.push(method.unit.toUpperCase());
          }
        });
      }
    });
    const uniqueUnits = [...new Set(units)];
    const filteredUnits = uniqueUnits.filter((c) => ['SAT', 'USD', 'EUR', 'GBP'].includes(c));

    console.log('🔍 Currency Debug:', {
      mints: mints.length,
      allUnits: uniqueUnits,
      filteredUnits,
      mintDetails: mints.map((m) => ({
        mintUrl: m.mintUrl,
        nuts4: m.mintInfo?.nuts?.['4']?.methods?.map((method: any) => method.unit),
      })),
    });

    return filteredUnits;
  }, [mints]);

  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    (currencies[0] || 'SAT') as string
  );

  // Load mints with balances - no currency filtering in useEffect
  useEffect(() => {
    const loadMints = async () => {
      try {
        setLoading(true);
        console.log('🔍 Debug - Raw mints data:', mints);

        // Get balances for all mints
        const balances = await getBalances();
        console.log('🔍 Debug - Balances:', balances);

        // Combine mint info with balance data
        const mintsWithBalances = mints.map((mint) => {
          const mintData = {
            mintUrl: mint.mintUrl,
            name:
              mint.name ||
              mint.mintInfo?.name ||
              mint.mintUrl.replace('https://', '')?.split('/')?.[0] ||
              'Unknown Mint',
            unit: 'SAT', // Default to SAT for now
            amount: balances[mint.mintUrl] || 0,
            iconUrl: mint.mintInfo?.icon_url || null,
            mintInfo: mint.mintInfo, // Keep mint info for filtering
          };

          console.log('🔍 Debug - Processed mint:', {
            original: mint,
            processed: mintData,
          });

          return mintData;
        });

        // Sort by balance (highest first)
        const sortedMints = mintsWithBalances.sort((a, b) => (b.amount || 0) - (a.amount || 0));

        console.log('🔍 Debug - Final mints:', sortedMints);
        setFilteredMints(sortedMints);
      } catch (error) {
        console.error('Failed to load mints:', error);
        setFilteredMints([]);
      } finally {
        setLoading(false);
      }
    };

    loadMints();
  }, [mints, getBalances]);

  // Filter mints by selected currency in render phase
  const filteredMintsForCurrency = useMemo(() => {
    return filteredMints.filter((mint) => {
      if (!mint.mintInfo?.nuts?.['4']?.methods) {
        // If no nuts data, default to SAT for backward compatibility
        return selectedCurrency === 'SAT';
      }

      // Check if this mint supports the selected currency
      return mint.mintInfo.nuts['4'].methods.some(
        (method: any) => method.unit?.toUpperCase() === selectedCurrency
      );
    });
  }, [filteredMints, selectedCurrency]);

  const dispatch = useDispatch();
  const profileId = useSelector(memoizedGetCurrentProfile).id;
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleMintSelect = async (mintUrl: string) => {
    const mint = filteredMints.find((m) => m.mintUrl === mintUrl);
    if (!mint) {
      sheetRef.current?.hide();
      return;
    }

    if (payload?.requireBalance && mint.amount === 0) {
      showMessage('insufficient_balance', {
        amount: mint.amount,
        unit: mint.unit,
        fee: 0,
      });
      return;
    }

    setLoadingId(mint.mintUrl);
    try {
      if (payload?.onMintPress) {
        payload.onMintPress(
          {
            id: mint.mintUrl,
            name: mint.name,
            iconUrl: mint.iconUrl,
            unit: mint.unit,
          },
          {
            amount: mint.amount,
            unit: mint.unit,
          }
        );
      } else if (payload?.updateSelectedMint !== false) {
        dispatch(setSelectedMint({ profileId, mintUrl: mint.mintUrl }));
      }
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
        name: mint.name,
        iconUrl: mint.iconUrl,
        unit: mint.unit,
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'mint_change_failed') {
        showMessage('general_error', {}, { emoji: '🚨' }, () => {
          sheetRef.current?.hide();
        });
      }
    } finally {
      setLoadingId(null);
    }
  };

  if (loading) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <VStack className="items-center p-5">
          <ActivityIndicator size="large" color={greys(theme)[0]} />
          <Spacer size={10} />
          <Text className="text-sm" style={{ color: greys(theme)[200] }}>
            Loading balances...
          </Text>
        </VStack>
      </Wrapper>
    );
  }

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => sheetRef.current?.hide(),
            },
            ...(showAddMintsButton
              ? [
                  {
                    text: 'Add mints',
                    variant: 'primary' as const,
                    onPress: async () => {
                      if (onAddMintsPress) {
                        onAddMintsPress();
                      } else {
                        // Navigate to add mints sheet
                        import('react-native-actions-sheet').then(({ SheetManager }) => {
                          SheetManager.show('mint', {
                            payload: {
                              initialRoute: 'mintAddMore',
                            },
                          });
                        });
                      }
                    },
                  },
                ]
              : []),
          ]}
        />
      }>
      <VStack flex={1}>
        <VStack>
          <Text
            style={{
              color: greys(theme)[0],
              fontSize: 18,
              fontWeight: '600',
              marginBottom: 4,
            }}>
            Send payment in
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1 }}>
            {currencies.map((currency: any) => (
              <TouchableOpacity
                key={currency}
                style={{
                  marginRight: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 8,
                  minWidth: 100,
                  backgroundColor:
                    selectedCurrency === currency ? greys(theme)[700] : greys(theme)[900],
                }}
                onPress={() => setSelectedCurrency(currency)}>
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
                  <Text style={{ color: greys(theme)[0], fontSize: 14, fontWeight: 'bold' }}>
                    {currency === 'SAT' ? 'BTC' : currency}
                  </Text>
                </HStack>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </VStack>
        <Spacer size={16} />

        <VStack>
          <Text
            style={{
              color: greys(theme)[0],
              fontSize: 18,
              fontWeight: '600',
              marginBottom: 4,
            }}>
            Send from
          </Text>
          <VStack>
            {filteredMintsForCurrency.map((mint) => (
              <MintItem
                key={mint.mintUrl}
                mint={{
                  id: mint.mintUrl,
                  name: mint.name,
                  iconUrl: mint.iconUrl,
                }}
                balance={{ amount: mint.amount, unit: mint.unit }}
                theme={theme}
                isLoading={loadingId === mint.mintUrl}
                globalLoading={loadingId !== null}
                requireBalance={payload?.requireBalance}
                selectedCurrency={selectedCurrency}
                showDetailsButton={showDetailsButton}
                onDetailsPress={onDetailsPress}
                onPress={() => handleMintSelect(mint.mintUrl)}
              />
            ))}
          </VStack>
        </VStack>
      </VStack>
    </Wrapper>
  );
};

export default ListRoute;
