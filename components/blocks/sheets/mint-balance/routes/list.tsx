/**
 * @fileoverview ListRoute - Mint selection with balances
 *
 * @module components/blocks/sheets/mint-balance/routes/list
 *
 * @description
 * Displays owned mints with balances, currency filtering, and selection options.
 * Users can select mints for transactions, add new mints, or inspect details.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: `router.navigate('add')` or `router.navigate('info', {mintUrl})`
 * - Close: `sheetRef.current?.hide({payload: selectedMint})`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Configuration and callbacks
 * - Params: None (initial route)
 *
 * **Flow:** Load mints → display with balances → user selects → callback/navigate → close
 *
 * @see {@link ./add}
 * @see {@link ./info}
 */

import React, { useState, useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useDispatch, useSelector } from 'react-redux';
import { useMintManagement } from 'hooks/coco';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Avatar } from 'components/ui/Avatar';
import { popup } from '@/helper/popup';
import { setSelectedMint } from 'redux/cashu';
import { memoizedGetCurrentProfile } from 'redux/nostr';
import { router as expoRouter } from 'expo-router';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { formatAmount } from 'helper/currency';
import { MintCurrencySelector } from '../MintCurrencySelector';
import _ from 'lodash';
import { Mint } from 'coco-cashu-core';

interface MintItemProps {
  mint: Mint & { amount: number; unit: string };
  balance: { amount: number; unit: string };
  onPress: () => void;
  isLoading: boolean;
  globalLoading: boolean;
  requireBalance?: boolean;
  selectedCurrency: string;
  showDetailsButton?: boolean;
  onInspectPress?: () => void;
}

const MintItem: React.FC<MintItemProps> = ({
  mint,
  balance,
  onPress,
  isLoading,
  globalLoading,
  requireBalance: _requireBalance = true,
  showDetailsButton = false,
  onInspectPress,
}) => {
  const { getPrimaryColor } = useTheme();
  const formattedBalance = balance.amount
    ? formatAmount(
        { amount: balance.amount, unit: balance.unit },
        {
          currencyDisplay: balance.unit.toLowerCase() === 'sat' ? 'name' : 'symbol',
        }
      )
    : '0';

  return (
    <TouchableOpacity
      className="bg-primary-900"
      style={{
        padding: 16,
        marginBottom: 4,
        borderRadius: 16,
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
            {isLoading && <ActivityIndicator animating size="small" color={getPrimaryColor('0')} />}
          </View>
        </View>

        <VStack flex={1}>
          <Text className="text-primary-0" size={16} bold overpass>
            {mint.name}
          </Text>
          <Text className="text-primary-200" size={14}>
            {formattedBalance}
          </Text>
        </VStack>

        {showDetailsButton && (
          <TouchableOpacity
            onPress={() => {
              if (onInspectPress) {
                onInspectPress();
              }
            }}>
            <Icon
              className="bg-primary-800/75"
              style={{
                padding: 8,
                borderRadius: 1000,
              }}
              name="bx:dots-vertical-rounded"
            />
          </TouchableOpacity>
        )}
      </HStack>
    </TouchableOpacity>
  );
};

/**
 * ListRoute Component
 *
 * @component
 * @param {RouteScreenProps<'mint-balance', 'list'>} props
 * @returns {JSX.Element}
 */
const ListRoute = () => {
  const { getPrimaryColor } = useTheme();
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const router = useSheetRouter('mint-balance');

  const showAddMintsButton = payload?.showAddMintsButton ?? false;
  const showDetailsButton = payload?.showDetailsButton ?? false;
  const onAddMintsPress = payload?.onAddMintsPress;

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

  /**
   * Handles mint selection
   *
   * @async
   * @description Validates balance, executes callback, updates state, navigates, closes sheet
   *
   * **Process:** validate → callback/state → navigate → sheetRef.hide()
   * **Effects:** Redux dispatch, navigation, popup notifications, sheet close
   *
   * @param {string} mintUrl - Selected mint URL
   */
  const handleMintSelect = async (mintUrl: string) => {
    const mint = filteredMints.find((m) => m.mintUrl === mintUrl);
    if (!mint) {
      sheetRef.current?.hide();
      return;
    }

    if (payload?.requireBalance && mint.amount === 0) {
      popup({
        message: 'insufficient_balance',
        params: {
          amount: mint.amount,
          unit: mint.unit,
          fee: 0,
        },
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
            iconUrl: mint.mintInfo.icon_url || null,
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
            to: 'sendToken',
            unit: mint.unit.toLowerCase(),
            type: payload?.accountType,
            accountIndex: payload?.accountIndex?.toString(),
          },
        });
      }

      sheetRef.current?.hide({
        id: mint.mintUrl,
        name: mint.name,
        iconUrl: mint.mintInfo.icon_url || null,
        unit: mint.unit,
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'mint_change_failed') {
        popup({
          message: 'general_error',
          emoji: '🚨',
          onClose: () => {
            sheetRef.current?.hide();
          },
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
          <ActivityIndicator size="large" color={getPrimaryColor('0')} />
          <Spacer size={10} />
          <Text className="text-sm text-primary-200">Loading balances...</Text>
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
        allowedCurrencies={['SAT', 'USD', 'EUR', 'GBP']}
        currencyLabel="Send payment in"
        mintsLabel="Send from"
        renderItem={(mint: Mint & { amount: number; unit: string }, selectedCurrency: string) => (
          <MintItem
            key={mint.mintUrl}
            mint={mint}
            balance={{ amount: mint.amount, unit: mint.unit }}
            isLoading={loadingId === mint.mintUrl}
            globalLoading={loadingId !== null}
            requireBalance={payload?.requireBalance}
            showDetailsButton={showDetailsButton}
            onInspectPress={() => {
              router?.navigate('info', { mintUrl: mint.mintUrl });
            }}
            selectedCurrency={selectedCurrency}
            onPress={() => handleMintSelect(mint.mintUrl)}
          />
        )}
      />
    </Wrapper>
  );
};

export default ListRoute;
