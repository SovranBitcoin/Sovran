import React, { useState, useMemo, useEffect } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { HStack, Spacer, VStack } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
import { useMintManagement } from 'hooks/coco';
import Icon, { CheckIcon, CurrencyIcon, FlagIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { Text } from 'components/ui/Text';
import { greys } from 'helper/colors';
import { formatCurrency } from 'helper/currency';
import { Avatar } from 'components/ui/Avatar';
import Wrapper from '../wrapper';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { memoizedGetTheme } from 'helper/redux/settings';
import { withSheetProvider } from 'hocs/withSheetProvider';

interface SelectedMintDisplayProps {
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
  unit?: string;
  onCancel?: () => void;
}

type SupportedCurrency = 'SAT' | 'USD' | 'EUR' | 'GBP';

interface MintState {
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
  theme: any;
  onPress: () => void;
}

const MintItem = React.memo<MintItemProps>(
  ({ mint, balance, isSelected, isLoading, globalLoading, selectedCurrency, theme, onPress }) => {
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

    const router = useSheetRouter('mint');

    return (
      <TouchableOpacity
        style={{
          padding: 16,
          marginBottom: 4,
          borderRadius: 16,
          backgroundColor: isSelected ? greys(theme)[700] : greys(theme)[900],
          opacity: globalLoading ? 0.5 : 1,
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
              {isLoading ? (
                <ActivityIndicator animating size="small" color={greys(theme)[0]} />
              ) : isSelected ? (
                <View
                  style={{
                    backgroundColor: greys(theme)[800],
                    borderRadius: 1000,
                    padding: 4,
                  }}>
                  <CheckIcon size={16} color={greys(theme)[0]} />
                </View>
              ) : null}
            </View>
          </View>

          <VStack flex={1}>
            <Text style={{ color: greys(theme)[0], fontSize: 16, fontWeight: '500' }}>
              {mint.name}
            </Text>
            <Text style={{ color: greys(theme)[200], fontSize: 14 }}>{formattedBalance}</Text>
          </VStack>

          <TouchableOpacity
            onPress={() => {
              router?.navigate('mintDetailsPage', {
                mintUrl: mint.id,
              });
            }}>
            <Icon
              style={{
                padding: 8,
                borderRadius: 1000,
                backgroundColor: isSelected ? `${greys(theme)[900]}80` : `${greys(theme)[800]}BF`,
              }}
              name="bx:dots-vertical-rounded"
            />
          </TouchableOpacity>
        </HStack>
      </TouchableOpacity>
    );
  }
);

MintItem.displayName = 'MintItem';

function MintSelectComponent({
  onMintSelected,
  unit,
  onCancel: _onCancel,
}: SelectedMintDisplayProps) {
  const theme = useSelector(memoizedGetTheme);
  const { getBalances, mints } = useMintManagement();

  const [mintState, setMintState] = useState<MintState>({
    loadingId: null,
  });
  const [selectedCurrency, setSelectedCurrency] = useState<SupportedCurrency>(
    (unit?.toUpperCase() || 'SAT') as SupportedCurrency
  );

  // Get currencies from mints (unit is in nuts[4].methods)
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

  // State for filtered mints with balances
  const [filteredMints, setFilteredMints] = useState<any[]>([]);

  // Load and filter mints based on selected currency
  useEffect(() => {
    const loadFilteredMints = async () => {
      try {
        console.log('🔍 Debug - Raw mints data:', mints);
        console.log('🔍 Debug - Selected currency:', selectedCurrency);

        // For now, let's show all mints regardless of currency to debug
        const mintsForCurrency = mints;

        console.log('🔍 Debug - Mints for currency:', mintsForCurrency);

        // Get balances for all mints
        const balances = await getBalances();
        console.log('🔍 Debug - Balances:', balances);

        // Combine mint info with balance data
        const mintsWithBalances = mintsForCurrency.map((mint) => {
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
          };

          console.log('🔍 Debug - Processed mint:', {
            original: mint,
            processed: mintData,
          });

          return mintData;
        });

        // Sort by balance (highest first)
        const sortedMints = mintsWithBalances.sort((a, b) => (b.amount || 0) - (a.amount || 0));

        console.log('🔍 Debug - Final filtered mints:', sortedMints);
        setFilteredMints(sortedMints);
      } catch (error) {
        console.error('Failed to load filtered mints:', error);
        setFilteredMints([]);
      }
    };

    loadFilteredMints();
  }, [mints, selectedCurrency, getBalances]);

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
        setMintState(() => ({
          loadingId: null,
        }));

        // Close the modal after successful selection
        router?.goBack();
      } catch {
        setMintState((prev) => ({
          ...prev,
          loadingId: null,
        }));

        showMessage('general_error', {}, { emoji: '🚨' });
      }
    }
  };

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const router = useSheetRouter('mint');

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Cancel',
              variant: 'secondary' as const,
              onPress: async () => {
                router?.goBack();
              },
              loading: mintState.loadingId !== null,
            },
            {
              text: 'Add mints',
              variant: 'primary' as const,
              onPress: async () => {
                router?.navigate('mintAddMore');
              },
              loading: mintState.loadingId !== null,
            },
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
            {filteredMints.map((mint) => (
              <MintItem
                key={mint.mintUrl}
                mint={{
                  id: mint.mintUrl,
                  name: mint.name,
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
                      name: mint.name,
                      iconUrl: mint.iconUrl,
                    },
                    { amount: mint.amount, unit: mint.unit }
                  )
                }
              />
            ))}
          </VStack>
        </VStack>
      </VStack>
    </Wrapper>
  );
}

MintSelectComponent.displayName = 'MintSelectComponent';

export const MintSelect = withSheetProvider(MintSelectComponent);
