import React, { useState, useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useDispatch, useSelector } from 'react-redux';
import { useMintManagement } from 'hooks/coco';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Avatar } from 'components/ui/Avatar';
import { showMessage } from 'helper/popup/popups';
import { setSelectedMint } from 'helper/redux/cashu';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { router as expoRouter } from 'expo-router';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { formatCurrency } from 'helper/currency';
import { MintCurrencySelector } from '../MintCurrencySelector';
import _ from 'lodash';
import { Mint } from 'coco-cashu-core';

interface MintItemProps {
  mint: Mint & { amount: number; unit: string };
  balance: { amount: number; unit: string };
  theme: Theme;
  onPress: () => void;
  isLoading: boolean;
  globalLoading: boolean;
  requireBalance?: boolean;
  selectedCurrency: string;
  showDetailsButton?: boolean;
  onDetailsPress?: (mintUrl: string) => void;
  onInspectPress?: () => void;
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
  onInspectPress,
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
            picture={mint.mintInfo.icon_url || undefined}
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
                onDetailsPress(mint.mintUrl);
              } else if (onInspectPress) {
                onInspectPress();
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
  const router = useSheetRouter('mint-balance');

  const showAddMintsButton = payload?.showAddMintsButton ?? false;
  const showDetailsButton = payload?.showDetailsButton ?? false;
  const onAddMintsPress = payload?.onAddMintsPress;
  const onDetailsPress = payload?.onDetailsPress;

  const { getBalances, mints } = useMintManagement();
  const [filteredMints, setFilteredMints] = useState<(Mint & { amount: number; unit: string })[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  const dispatch = useDispatch();
  const profileId = useSelector(memoizedGetCurrentProfile).id;
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Load mints with balances
  useEffect(() => {
    const loadMints = async () => {
      try {
        setLoading(true);

        const balances = await getBalances();

        const mintsWithBalances = mints.map((mint) => ({
          unit: 'SAT',
          amount: balances[mint.mintUrl] || 0,
          ...mint,
        }));

        const sortedMints = _.orderBy(mintsWithBalances, ['amount'], ['desc']);

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
            iconUrl: mint.mintInfo.icon_url,
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

        expoRouter.push({
          pathname: '/currency',
          params: {
            to: 'ecashSendConfirmation',
            unit: mint.unit.toLowerCase(),
            type: payload?.accountType,
            accountIndex: payload?.accountIndex?.toString(),
          },
        });
      }

      sheetRef.current?.hide({
        id: mint.mintUrl,
        name: mint.name,
        iconUrl: mint.mintInfo.icon_url,
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
                        router?.navigate('add');
                      }
                    },
                  },
                ]
              : []),
          ]}
        />
      }>
      <MintCurrencySelector
        mints={filteredMints}
        theme={theme}
        allowedCurrencies={['SAT', 'USD', 'EUR', 'GBP']}
        currencyLabel="Send payment in"
        mintsLabel="Send from"
        renderItem={(mint: any, selectedCurrency: string) => (
          <MintItem
            key={mint.mintUrl}
            mint={mint}
            balance={{ amount: mint.amount, unit: mint.unit }}
            theme={theme}
            isLoading={loadingId === mint.mintUrl}
            globalLoading={loadingId !== null}
            requireBalance={payload?.requireBalance}
            selectedCurrency={selectedCurrency}
            showDetailsButton={showDetailsButton}
            onDetailsPress={onDetailsPress}
            onInspectPress={() => {
              // Store mintUrl in a global variable temporarily
              console.log('Setting global.currentMintUrl to:', mint.mintUrl);
              (global as any).currentMintUrl = mint.mintUrl;
              router?.navigate('info');
            }}
            onPress={() => handleMintSelect(mint.mintUrl)}
          />
        )}
      />
    </Wrapper>
  );
};

export default ListRoute;
