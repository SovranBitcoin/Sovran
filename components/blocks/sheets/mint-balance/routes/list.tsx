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
import { Badge } from 'components/ui/Badge';
import { popup } from '@/helper/popup';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { router as expoRouter } from 'expo-router';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { getMintDisplayName, extractDomain } from 'helper/url';
import _ from 'lodash';
import { Mint } from 'coco-cashu-core';
import { useTheme } from '@/providers/ThemeProvider';
import { MintCurrencySelector } from '../MintCurrencySelector';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { useAuditedMint } from 'hooks/coco/useAuditedMint';
import { Skeleton } from '@/components/ui/Skeleton';
import opacity from 'hex-color-opacity';
import { Checkbox } from '@/components/ui/Checkbox';
import { AmountFormatter } from '@/components/ui/AmountFormatter';

interface MintItemProps {
  mint: Mint & { amount?: number; unit?: string };
  balance?: { amount: number; unit: string };
  mintUrl?: string;
  onPress: () => void;
  isLoading?: boolean;
  globalLoading?: boolean;
  requireBalance?: boolean;
  /** Minimum balance required - mints below this show at reduced opacity */
  minAmount?: number;
  selectedCurrency?: string;
  showDetailsButton?: boolean;
  onInspectPress?: () => void;
  kymScore?: number;
  kymLoading?: boolean;
  showCheckbox?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}

const MintItem: React.FC<MintItemProps> = ({
  mint,
  balance,
  mintUrl: mintUrlProp,
  onPress,
  isLoading = false,
  globalLoading = false,
  requireBalance: _requireBalance = false,
  minAmount,
  showDetailsButton = false,
  onInspectPress,
  selectedCurrency: _selectedCurrency,
  kymScore,
  kymLoading = false,
  showCheckbox = false,
  selected = false,
  onToggle,
}) => {
  const { getGreenColor } = useTheme();
  const displayMintUrl = mintUrlProp || mint.mintUrl;
  const displayName = useMemo(
    () => getMintDisplayName(displayMintUrl, mint.mintInfo),
    [displayMintUrl, mint.mintInfo]
  );

  // Fetch audit data
  const { auditInfo, loading: auditLoading } = useAuditedMint(displayMintUrl);

  // Calculate success rate percentage
  const successRate = useMemo(() => {
    if (auditInfo?.score !== undefined) {
      // Use auditInfo.score (0-5 scale), normalize to 0-1 then convert to percentage
      return Math.round((auditInfo.score / 5) * 100);
    }
    if (auditInfo?.auditorData) {
      const { mints, melts, errors } = auditInfo.auditorData;
      const totalOps = (mints || 0) + (melts || 0);
      if (totalOps > 0) {
        return Math.round((1 - (errors || 0) / totalOps) * 100);
      }
    }
    return undefined;
  }, [auditInfo]);

  const { getPrimaryColor } = useTheme();

  // Format score (round to 1 decimal or whole number)
  // Note: score of 0 is a valid value, so we check typeof === 'number' not just truthiness
  const displayScore = useMemo(() => {
    if (typeof kymScore !== 'number') return undefined;
    return kymScore % 1 === 0 ? kymScore.toString() : kymScore.toFixed(1);
  }, [kymScore]);

  // Determine badge variant based on audit state
  const activityBadgeVariant = useMemo(() => {
    const state = auditInfo?.auditorData?.state;
    if (state === 'ERROR') {
      return 'error';
    }
    // Default to success for OK state or when state is undefined/loading
    return 'success';
  }, [auditInfo?.auditorData?.state]);
  const { getYellowColor } = useTheme();

  // Determine opacity based on balance and requirements
  const itemOpacity = useMemo(() => {
    if (globalLoading) return 0.5;
    if (balance && balance.amount === 0 && _requireBalance) return 0.5;
    // Show at reduced opacity if balance is below minimum required amount
    if (minAmount !== undefined && minAmount > 0 && balance && balance.amount < minAmount)
      return 0.5;
    return 1;
  }, [globalLoading, balance, _requireBalance, minAmount]);

  // Check if this mint has insufficient balance for selection
  const hasInsufficientBalance = useMemo(() => {
    if (minAmount !== undefined && minAmount > 0 && balance) {
      return balance.amount < minAmount;
    }
    return false;
  }, [minAmount, balance]);

  return (
    <TouchableOpacity
      className="bg-primary-900"
      style={{
        padding: 16,
        marginBottom: 4,
        borderRadius: 16,
        opacity: itemOpacity,
      }}
      onPress={onPress}
      disabled={globalLoading || hasInsufficientBalance}>
      <VStack gap={0}>
        {/* Top section: Logo, name, balance/URL, checkbox/dots */}
        <HStack align="center" gap={12}>
          <View style={{ position: 'relative' }}>
            <Avatar
              picture={mint.mintInfo?.icon_url || undefined}
              size={42}
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

            <View style={{ alignSelf: 'flex-start' }}>
              {balance ? (
                <AmountFormatter
                  amount={balance.amount}
                  unit={'sat'}
                  size={14}
                  weight="heavy"
                  color={getPrimaryColor('0')}
                  className="ml-[2px]"
                />
              ) : displayMintUrl ? (
                <Text heavy className="text-primary-300" size={14}>
                  {extractDomain(displayMintUrl)}
                </Text>
              ) : null}
            </View>
          </VStack>

          {showCheckbox ? (
            <Checkbox
              checked={selected}
              onCheckedChange={() => {
                if (onToggle) {
                  onToggle();
                }
              }}
              size={24}
              variant="success"
            />
          ) : (
            showDetailsButton && (
              <TouchableOpacity
                onPress={() => {
                  if (onInspectPress) {
                    onInspectPress();
                  }
                }}>
                <Icon
                  className="bg-primary-600"
                  style={{
                    padding: 8,
                    borderRadius: 1000,
                  }}
                  name="bx:dots-vertical-rounded"
                />
              </TouchableOpacity>
            )
          )}
        </HStack>

        {(displayScore || kymLoading || successRate !== undefined || auditLoading) && (
          <>
            <Spacer size={12} />
            <HStack gap={8}>
              {/* Score badge (left) - show badge when score available, skeleton when loading without score */}
              {displayScore ? (
                <Badge className="h-[24px] w-[56px]" variant="star" icon="ic:round-star" size={14}>
                  {displayScore}
                </Badge>
              ) : kymLoading ? (
                <Skeleton
                  className="h-[24px] w-[56px] rounded-full"
                  style={{
                    backgroundColor: opacity(getYellowColor('300'), 0.2),
                  }}
                />
              ) : null}

              {/* Success rate badge (right) - show badge when available, skeleton only when loading */}
              {successRate !== undefined ? (
                <Badge
                  className="h-[24px] w-[60px]"
                  variant={activityBadgeVariant}
                  icon="lucide:activity"
                  size={14}>
                  {`${successRate}%`}
                </Badge>
              ) : auditLoading ? (
                <Skeleton
                  className="h-[24px] w-[60px] rounded-full"
                  style={{
                    backgroundColor: opacity(getGreenColor('300'), 0.2),
                  }}
                />
              ) : null}
            </HStack>
          </>
        )}
      </VStack>
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

  // Fetch KYM scores for all mints in a single batch
  const mintUrls = useMemo(() => processedMints.map((mint) => mint.mintUrl), [processedMints]);
  const { scores: kymScores, loading: kymLoading } = useKYMMints(mintUrls);

  // Helper to normalize URLs for lookup (same as in useKYMMints)
  // Only lowercases the domain, preserves path case (e.g., /Bitcoin stays /Bitcoin)
  const normalizeUrl = useCallback((url: string): string => {
    const withoutProtocol = url.replace(/^https?:\/\//, '');
    const slashIndex = withoutProtocol.indexOf('/');
    if (slashIndex === -1) {
      // No path, just domain
      return withoutProtocol
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/\/$/, '');
    }
    const domain = withoutProtocol
      .slice(0, slashIndex)
      .toLowerCase()
      .replace(/^www\./, '');
    const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
    return domain + path;
  }, []);

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

          expoRouter.navigate({
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
          (mint: Mint & { amount: number; unit: string }, selectedCurrency: string) => {
            const normalizedUrl = normalizeUrl(mint.mintUrl);
            const kymData = kymScores[normalizedUrl];
            const kymScore = kymData?.score;
            return (
              <MintItem
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
                kymScore={kymScore}
                kymLoading={kymLoading}
                onPress={() => handleMintSelect(mint.mintUrl)}
              />
            );
          },
          [
            loadingId,
            payload?.requireBalance,
            showDetailsButton,
            router,
            handleMintSelect,
            kymScores,
            kymLoading,
            normalizeUrl,
          ]
        )}
      />
    </Wrapper>
  );
};

export default ListRoute;
export { MintItem };
