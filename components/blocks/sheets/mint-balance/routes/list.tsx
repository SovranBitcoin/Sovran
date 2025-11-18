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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useMintManagement } from 'hooks/coco';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Avatar } from 'components/ui/Avatar';
import { popup } from '@/helper/popup';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { router as expoRouter } from 'expo-router';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { View, HStack, VStack } from 'components/ui/View';
import { getMintDisplayName } from 'helper/url';
import _ from 'lodash';
import { Mint } from 'coco-cashu-core';
import { AmountFormatter } from '@/components/ui/AmountFormatter';
import { useTheme } from '@/providers/ThemeProvider';
import { MintCurrencySelector } from '../MintCurrencySelector';

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
  selectedCurrency: _selectedCurrency,
}) => {
  const { getPrimaryColor } = useTheme();
  const primaryColor = getPrimaryColor('0');
  const displayName = useMemo(
    () => getMintDisplayName(mint.mintUrl, mint.mintInfo),
    [mint.mintUrl, mint.mintInfo]
  );

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
            name={displayName}
            alt={`${displayName} mint`}
          />
          <View style={{ position: 'absolute', bottom: -2, right: -2 }}>
            {isLoading && <View className="h-3 w-3 animate-pulse rounded-full bg-primary-600" />}
          </View>
        </View>

        <VStack flex={1}>
          <Text className="text-primary-0" size={16} bold overpass>
            {displayName}
          </Text>

          <AmountFormatter
            amount={balance.amount}
            unit={balance.unit.toLowerCase()}
            size={16}
            weight="heavy"
            color={primaryColor}
          />
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

// Memoize MintItem to prevent unnecessary re-renders
const MemoizedMintItem = React.memo(MintItem, (prevProps, nextProps) => {
  // Only re-render if these props change
  return (
    prevProps.mint.mintUrl === nextProps.mint.mintUrl &&
    prevProps.mint.amount === nextProps.mint.amount &&
    prevProps.mint.unit === nextProps.mint.unit &&
    prevProps.balance.amount === nextProps.balance.amount &&
    prevProps.balance.unit === nextProps.balance.unit &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.globalLoading === nextProps.globalLoading &&
    prevProps.requireBalance === nextProps.requireBalance &&
    prevProps.selectedCurrency === nextProps.selectedCurrency &&
    prevProps.showDetailsButton === nextProps.showDetailsButton
  );
});

/**
 * ListRoute Component
 *
 * @component
 * @param {RouteScreenProps<'mint-balance', 'list'>} props
 * @returns {JSX.Element}
 */
const ListRoute = () => {
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
  const [, setLoading] = useState(true);

  const setSelectedMint = useMintStore((state) => state.setSelectedMint);
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;

  if (__DEV__) {
    console.log('MintBalance: keys from NostrKeysContext:', keys, 'using pubkey:', pubkey);
  }
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Memoize balances loading to prevent unnecessary re-fetches
  const balancesRef = React.useRef<Record<string, number>>({});
  const [balances, setBalances] = useState<Record<string, number>>({});

  // Load balances separately and memoize
  useEffect(() => {
    let cancelled = false;
    const loadBalances = async () => {
      try {
        const newBalances = await getBalances();
        if (!cancelled) {
          balancesRef.current = newBalances;
          setBalances(newBalances);
        }
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to load balances:', error);
        }
        if (!cancelled) {
          setBalances({});
        }
      }
    };

    loadBalances();
    return () => {
      cancelled = true;
    };
  }, [getBalances]);

  // Memoize expensive mint processing
  const processedMints = useMemo(() => {
    if (mints.length === 0) return [];

    const mintsWithBalances = mints.map((mint) => ({
      unit: 'SAT',
      amount: balances[mint.mintUrl] || 0,
      ...mint,
    }));

    return _.orderBy(mintsWithBalances, ['amount'], ['desc']);
  }, [mints, balances]);

  // Update filteredMints when processedMints changes
  useEffect(() => {
    setFilteredMints(processedMints);
    setLoading(false);
  }, [processedMints]);

  // Debug logging (only in dev)
  useEffect(() => {
    if (__DEV__ && processedMints.length > 0) {
      console.log('📋 LIST PAGE LOADING DEBUG:');
      console.log('📋 Mints from useMintManagement:', mints.length);
      console.log(
        '📋 Mint URLs from useMintManagement:',
        mints.map((m) => m.mintUrl)
      );
      console.log('💰 Balances from getBalances:', Object.keys(balances).length);
      console.log('💰 Balance URLs:', Object.keys(balances));
      console.log('📋 Final sorted mints for list:', processedMints.length);
      console.log(
        '📋 Final sorted mint URLs:',
        processedMints.map((m) => m.mintUrl)
      );
    }
  }, [mints, balances, processedMints]);

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
  const handleMintSelect = useCallback(
    async (mintUrl: string) => {
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
        // Always call the callback if provided
        if (payload?.onMintPress) {
          if (__DEV__) {
            console.log('MintBalance: Calling onMintPress callback');
          }
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
        }

        // Also update the store if updateSelectedMint is true
        if (payload?.updateSelectedMint !== false) {
          if (!pubkey) {
            if (__DEV__) {
              console.warn('MintBalance: No pubkey available, cannot set selected mint');
            }
            return;
          }
          if (__DEV__) {
            console.log('MintBalance: Setting selected mint in store:', {
              pubkey,
              mintUrl: mint.mintUrl,
              mintName: mint.name,
            });
          }
          setSelectedMint(pubkey, mint.mintUrl);
          if (__DEV__) {
            console.log('MintBalance: Selected mint set successfully in store');
          }
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

        if (__DEV__) {
          console.log('MintBalance: hiding sheet with mint data:', {
            id: mint.mintUrl,
            name: mint.name,
            iconUrl: mint.mintInfo.icon_url || null,
            unit: mint.unit,
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
    },
    [filteredMints, payload, pubkey, setSelectedMint, sheetRef]
  );

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
        renderItem={useCallback(
          (mint: Mint & { amount: number; unit: string }, selectedCurrency: string) => (
            <MemoizedMintItem
              key={mint.mintUrl}
              mint={mint}
              balance={{ amount: mint.amount, unit: mint.unit }}
              isLoading={loadingId === mint.mintUrl}
              globalLoading={loadingId !== null}
              requireBalance={payload?.requireBalance}
              showDetailsButton={showDetailsButton}
              onInspectPress={() => {
                if (__DEV__) {
                  console.log('🔍 LIST PAGE: Navigating to info with mintUrl:', mint.mintUrl);
                }
                router?.navigate('info', { mintUrl: mint.mintUrl });
              }}
              selectedCurrency={selectedCurrency}
              onPress={() => handleMintSelect(mint.mintUrl)}
            />
          ),
          [loadingId, payload?.requireBalance, showDetailsButton, router, handleMintSelect]
        )}
      />
    </Wrapper>
  );
};

export default ListRoute;
