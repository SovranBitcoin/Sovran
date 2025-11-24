/**
 * @fileoverview AddRoute - Discover and add new mints
 *
 * @module components/blocks/sheets/mint-balance/routes/add
 *
 * @description
 * Discovers available mints, allows custom URL entry, and adds selected mints to wallet.
 * Users can search discovered mints, add custom URLs, and select multiple mints for addition.
 *
 * **Navigation:**
 * - From: `router.navigate('add')` from list route
 * - To: `router.goBack()` after successful addition
 * - Close: `sheetRef.current?.hide({payload: result})`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Allowed currencies and configuration
 * - Params: None (direct navigation)
 *
 * **Flow:** Load discovered mints → search/filter → select mints → add to wallet → close
 *
 * @see {@link ./list}
 * @see {@link ./info}
 */

import React, { useState, useMemo, useCallback, memo } from 'react';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { popup } from '@/helper/popup';
import { HStack, View, VStack } from 'components/ui/View';
import { MintSearchInput } from 'components/ui/MintSearchInput';
import { useDebouncedMintValidation } from 'hooks/coco/useDebouncedMintValidation';
import { filterMints } from 'helper/fuzzySearch';
import { extractDomain, getMintDisplayName } from '@/helper/url';
import { CocoManager } from 'helper/coco/manager';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNostrDiscoveredMints } from '@/hooks/coco/useNostrDiscoveredMints';
import { useSovranDiscoveredMints } from '@/hooks/coco/useSovranDiscoveredMints';
import type { SovranDiscoveredMintData } from '@/hooks/coco/useSovranDiscoveredMints';
import { useMintManagement } from 'hooks/coco';
import type { NostrDiscoveredMintData } from '@/hooks/coco/useNostrDiscoveredMints';
import { MintItem } from './list';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { useAuditedMint } from 'hooks/coco/useAuditedMint';
import { useAuditMintStore } from 'stores/auditMintStore';
import { Mint } from 'coco-cashu-core';
import { MintCurrencySelector } from '../MintCurrencySelector';
import { Checkbox } from '@/components/ui/Checkbox';
import { TouchableOpacity } from 'react-native';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import Icon from '@/assets/icons';

interface PseudoMint {
  url: string;
  isPseudoMint: true;
  mintInfo?: any;
  name?: string;
}

// Extend discovered mint data to include name for compatibility with filterMints
interface SearchableDiscoveredMint {
  url: string;
  score: number;
  recommendations: any[];
  mintInfo: any | null;
  name: string;
  auditInfo?: {
    score: number;
    auditorData: {
      name: string;
      state: string;
    };
    recommendations: any[];
  };
}

type SearchableMint = SearchableDiscoveredMint | PseudoMint;

const isPseudoMint = (mint: SearchableMint): mint is PseudoMint => {
  return 'isPseudoMint' in mint && mint.isPseudoMint === true;
};

// Convert discovered mint data to SearchableDiscoveredMint
const adaptDiscoveredMint = (
  mint: NostrDiscoveredMintData | SovranDiscoveredMintData
): SearchableDiscoveredMint => {
  return {
    ...mint,
    name: mint.mintInfo?.name || extractDomain(mint.url),
    // Map data to expected structure for backward compatibility
    auditInfo: {
      score: mint.score,
      auditorData: {
        name: mint.mintInfo?.name || extractDomain(mint.url),
        state: mint.mintInfo ? 'OK' : 'OFFLINE',
      },
      recommendations: mint.recommendations || [],
    },
  };
};

// Loading state component for the mints section
const LoadingMintsList = ({ count = 5 }: { count?: number }) => {
  return (
    <VStack spacing={0}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className="bg-primary-900"
          style={{
            padding: 16,
            marginBottom: 4,
            borderRadius: 16,
          }}>
          <VStack gap={12}>
            <View className="flex-row items-center gap-3">
              <Skeleton
                className="h-[42px] w-[42px] bg-primary-700"
                style={{ borderRadius: 42 * 0.25 }}
              />
              <VStack flex={1} gap={8}>
                <Skeleton className="h-[16px] bg-primary-700" style={{ width: 150 }} />
                <Skeleton className="h-[20px] rounded-full bg-primary-700" style={{ width: 80 }} />
              </VStack>
            </View>
            <View className="flex-row gap-2">
              <Skeleton className="h-[24px] rounded-full bg-primary-700" style={{ width: 56 }} />
              <Skeleton className="h-[24px] rounded-full bg-primary-700" style={{ width: 60 }} />
            </View>
          </VStack>
        </View>
      ))}
    </VStack>
  );
};

/**
 * AddRoute Component
 *
 * @component
 * @param {RouteScreenProps<'mint-balance', 'add'>} props
 * @returns {JSX.Element}
 */
const AddRoute = () => {
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getPrimaryColor } = useTheme();

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  // Search functionality
  const {
    url,
    setUrl,
    validationState,
    mintInfo: customMintInfo,
  } = useDebouncedMintValidation(800);

  // Helper function to normalize URLs for comparison
  const normalizeUrl = useCallback((url: string): string => {
    // Remove trailing slash and normalize
    return url.replace(/\/$/, '');
  }, []);

  // Use both Nostr and Sovran API discovered mints hooks
  const {
    mints: nostrDiscoveredMints,
    loading: nostrLoading,
    error: nostrError,
    retry: nostrRetry,
  } = useNostrDiscoveredMints();
  const {
    mints: sovranDiscoveredMints,
    loading: sovranLoading,
    error: sovranError,
    retry: sovranRetry,
  } = useSovranDiscoveredMints();

  // Combine mints from both sources, ensuring uniqueness
  const discoveredMints = useMemo(() => {
    const allMints = [...nostrDiscoveredMints, ...sovranDiscoveredMints];
    const seenUrls = new Set<string>();
    const uniqueMints: (NostrDiscoveredMintData | SovranDiscoveredMintData)[] = [];

    for (const mint of allMints) {
      const normalizedUrl = normalizeUrl(mint.url);
      if (!seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        uniqueMints.push(mint);
      }
    }

    console.log(
      `📊 Combined mints: ${nostrDiscoveredMints.length} from Nostr, ${sovranDiscoveredMints.length} from Sovran, ${uniqueMints.length} unique total`
    );

    return uniqueMints;
  }, [nostrDiscoveredMints, sovranDiscoveredMints, normalizeUrl]);

  // Combined loading state (loading if either source is loading)
  const loading = nostrLoading || sovranLoading;
  // Combined error state (show error if both fail, or if one fails and the other has no results)
  const error =
    nostrError && sovranError
      ? `Nostr: ${nostrError}. Sovran: ${sovranError}`
      : nostrError || sovranError || null;

  // Combined retry function
  const retry = useCallback(() => {
    nostrRetry();
    sovranRetry();
  }, [nostrRetry, sovranRetry]);
  // return (
  //   <View>
  //     <Text>
  //       {JSON.stringify(discoveredMints, null, 2)}
  //       {String(loading)}
  //       {String(error)}
  //     </Text>
  //   </View>
  // );
  // Get known mints for filtering
  const { mints: knownMints } = useMintManagement();

  // Get allowed currencies from payload or use defaults
  const allowedCurrencies = payload?.allowedUnits ?? ['SAT', 'USD', 'EUR', 'GBP'];

  // Filter mints based on search query and exclude known mints
  const filteredMints = useMemo((): SearchableMint[] => {
    // Get known mint URLs for exclusion (normalized)
    const knownMintUrls = new Set(knownMints.map((mint) => normalizeUrl(mint.mintUrl)));

    // Convert discovered mints to searchable format and exclude known mints
    const searchableDiscoveredMints = discoveredMints
      .filter((mint) => {
        const normalizedDiscoveredUrl = normalizeUrl(mint.url);
        const isKnown = knownMintUrls.has(normalizedDiscoveredUrl);
        return !isKnown;
      })
      .map(adaptDiscoveredMint);

    if (!url.trim()) return searchableDiscoveredMints;

    const filtered = filterMints(searchableDiscoveredMints, url);

    // If the URL has been validated successfully and doesn't match any existing mints,
    // add a pseudo mint for the custom URL
    // Only show pseudo mint if validation succeeded AND we have mint info
    const normalizedUrl = normalizeUrl(url);
    const urlExistsInFiltered = filtered.some((mint) => normalizeUrl(mint.url) === normalizedUrl);

    if (validationState.isValid === true && customMintInfo !== null && !urlExistsInFiltered) {
      const pseudoMint: PseudoMint = {
        url,
        isPseudoMint: true,
        mintInfo: customMintInfo,
        name: extractDomain(url),
      };
      return [pseudoMint, ...filtered];
    }

    return filtered;
  }, [discoveredMints, knownMints, url, customMintInfo, validationState, normalizeUrl]);

  // Fetch KYM scores for all mints in a single batch
  const mintUrls = useMemo(() => filteredMints.map((mint) => mint.url), [filteredMints]);
  const { scores: kymScores, loading: kymLoading } = useKYMMints(mintUrls);

  // Get audit store to access cached audit data for sorting
  const getCached = useAuditMintStore((state) => state.getCached);

  // Helper function to calculate success rate from cached audit data
  const getSuccessRateFromCache = useCallback(
    (mintUrl: string): number | undefined => {
      const cached = getCached(mintUrl);
      if (!cached?.auditData) return undefined;

      const auditData = cached.auditData;
      // Calculate success rate (same logic as in Item component)
      const totalOps = auditData.n_mints + auditData.n_melts;
      if (totalOps > 0) {
        return Math.round((1 - auditData.n_errors / totalOps) * 100);
      }
      return undefined;
    },
    [getCached]
  );

  // Sort mints: first by success rate (heartbeat), then by KYM score
  const sortedMints = useMemo((): SearchableMint[] => {
    return [...filteredMints].sort((a, b) => {
      const normalizedA = normalizeUrl(a.url);
      const normalizedB = normalizeUrl(b.url);

      // Get success rates from cached audit data
      const successRateA = getSuccessRateFromCache(a.url);
      const successRateB = getSuccessRateFromCache(b.url);

      // Get KYM scores
      const kymScoreA = kymScores[normalizedA]?.score;
      const kymScoreB = kymScores[normalizedB]?.score;

      // Sort by success rate first (heartbeat percentage) - descending
      if (successRateA !== undefined && successRateB !== undefined) {
        if (successRateA !== successRateB) {
          return successRateB - successRateA; // Higher success rate first
        }
      } else if (successRateA !== undefined) {
        return -1; // A has success rate, B doesn't - A comes first
      } else if (successRateB !== undefined) {
        return 1; // B has success rate, A doesn't - B comes first
      }

      // If success rates are equal or both undefined, sort by KYM score - descending
      if (kymScoreA !== undefined && kymScoreB !== undefined) {
        return kymScoreB - kymScoreA; // Higher score first
      } else if (kymScoreA !== undefined) {
        return -1; // A has score, B doesn't - A comes first
      } else if (kymScoreB !== undefined) {
        return 1; // B has score, A doesn't - B comes first
      }

      // If neither has success rate or score, maintain original order
      return 0;
    });
  }, [filteredMints, kymScores, getSuccessRateFromCache, normalizeUrl]);

  const handleToggleMint = useCallback((url: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);
  /**
   * Handles mint addition
   *
   * @async
   * @description Adds selected mints to wallet via CocoManager, shows progress, closes sheet
   *
   * **Process:** validate → addMint() for each → show results → sheetRef.hide()
   * **Effects:** Wallet updates, popup notifications, sheet close
   */
  const handleSave = async () => {
    if (selectedMints.size === 0) {
      popup({ message: 'Please select at least one mint to add', type: 'warning' });
      return;
    }

    if (isAdding) {
      console.warn('⚠️ Already adding mints, ignoring duplicate request');
      return;
    }

    setIsAdding(true);

    try {
      if (!CocoManager.isInitialized()) {
        console.error('❌ CocoManager not initialized');
        popup({ message: 'Manager not initialized. Please try again.', type: 'error' });
        setIsAdding(false);
        return;
      }

      const manager = CocoManager.getInstance();
      const results = [];
      const errors = [];
      const mintUrls = Array.from(selectedMints);

      console.log(`🔄 Starting to add ${mintUrls.length} mint(s):`, mintUrls);

      // Process mints sequentially with a small delay to avoid race conditions
      for (let i = 0; i < mintUrls.length; i++) {
        const mintUrl = mintUrls[i];
        console.log(`📌 Processing mint ${i + 1}/${mintUrls.length}: ${mintUrl}`);

        try {
          // Trust the mint
          await manager.mint.trustMint(mintUrl);
          console.log(`✅ Successfully trusted mint: ${mintUrl}`);
          results.push(mintUrl);

          // Try to fetch mint info (non-critical, so we don't fail if this errors)
          try {
            await manager.mint.getMintInfo(mintUrl);
            console.log(`✅ Successfully fetched mint info: ${mintUrl}`);
          } catch (infoErr) {
            console.warn(`⚠️ Failed to fetch mint info for ${mintUrl}:`, infoErr);
            // Don't add to errors since trustMint succeeded
          }

          // Add a small delay between operations to avoid potential race conditions
          if (i < mintUrls.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (err) {
          console.error(`❌ Failed to add mint ${mintUrl}:`, err);
          errors.push({
            mintUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      console.log(`📊 Results: ${results.length} succeeded, ${errors.length} failed`);

      if (errors.length === 0) {
        popup({ message: `Successfully added ${results.length} mint(s)`, type: 'success' });
        sheetRef.current?.hide();
      } else if (results.length > 0) {
        popup({
          message: `Added ${results.length} mint(s), ${errors.length} failed`,
          type: 'warning',
        });
        // Still close the sheet if some succeeded
        sheetRef.current?.hide();
      } else {
        const errorMessages = errors
          .map((e) => `${extractDomain(e.mintUrl)}: ${e.error}`)
          .join(', ');
        console.error('❌ All mints failed:', errors);
        popup({
          message: `Failed to add any mints: ${errorMessages}`,
          type: 'error',
        });
        // Don't close the sheet if all failed, so user can retry
      }
    } catch (err) {
      console.error('❌ Failed to add mints:', err);
      popup({
        message: `Failed to add mints: ${err instanceof Error ? err.message : String(err)}`,
        type: 'error',
      });
    } finally {
      setIsAdding(false);
    }
  };

  // Render item callback for MintCurrencySelector (kept for reference during migration)
  const _renderMintItem = useCallback(
    (mint: SearchableMint, _selectedCurrency: string) => {
      const pseudo = isPseudoMint(mint);
      const normalizedUrl = normalizeUrl(mint.url);
      const kymData = kymScores[normalizedUrl];
      const kymScore = kymData?.score;

      // Create a compatible mint object for MintItem
      const mintObject: Mint = {
        mintUrl: mint.url,
        mintInfo: pseudo ? mint.mintInfo : mint.mintInfo ? mint.mintInfo : undefined,
      } as Mint;

      return (
        <MintItem
          key={mint.url}
          mint={mintObject}
          mintUrl={mint.url}
          balance={undefined}
          showCheckbox={true}
          selected={selectedMints.has(mint.url)}
          onToggle={() => handleToggleMint(mint.url)}
          onPress={() => handleToggleMint(mint.url)}
          isLoading={false}
          globalLoading={isAdding}
          kymScore={kymScore}
          kymLoading={kymLoading}
          showDetailsButton={false}
        />
      );
    },
    [selectedMints, handleToggleMint, isAdding, kymScores, kymLoading, normalizeUrl]
  );

  // Memoized render function for mint items
  const renderMintItemCallback = useCallback(
    (mint: SearchableMint, selectedCurrency: string) => {
      return (
        <Item
          mint={mint}
          selectedCurrency={selectedCurrency}
          selected={selectedMints.has(mint.url)}
          onToggle={handleToggleMint}
          mintUrl={mint.url}
          kymScores={kymScores}
          kymLoading={kymLoading}
          normalizeUrl={normalizeUrl}
          globalLoading={isAdding}
        />
      );
    },
    [selectedMints, handleToggleMint, kymScores, kymLoading, normalizeUrl, isAdding]
  );

  if (error) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Retry',
                variant: 'primary',
                onPress: async () => retry(),
              },
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <VStack className="items-center p-5">
          <Text className="text-center text-base" style={{ color: getPrimaryColor('200') }}>
            {error}
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
              text: isAdding ? 'Adding...' : `Add (${selectedMints.size})`,
              variant: 'primary',
              onPress: handleSave,
              disabled: selectedMints.size === 0 || isAdding,
            },
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => sheetRef.current?.hide(),
            },
          ]}
        />
      }>
      <VStack spacing={16}>
        <MintSearchInput value={url} onChangeText={setUrl} validationState={validationState} />

        <VStack spacing={0}>
          <MintCurrencySelector
            mints={sortedMints as any[]}
            allowedCurrencies={allowedCurrencies}
            currencyLabel="Currency options"
            mintsLabel={url.trim() ? 'Search results' : 'Discovered mints'}
            renderItem={renderMintItemCallback}
            customEmptyState={loading ? <LoadingMintsList /> : undefined}
            isLoading={loading}
            extraData={Array.from(selectedMints).sort().join(',')}
          />
        </VStack>
      </VStack>
    </Wrapper>
  );
};

const Item = memo(function Item({
  mint,
  selectedCurrency: _selectedCurrency,
  selected,
  onToggle,
  mintUrl,
  kymScores,
  kymLoading,
  normalizeUrl,
  globalLoading,
}: {
  mint: SearchableMint;
  selectedCurrency: string;
  selected: boolean;
  onToggle: (url: string) => void;
  mintUrl: string;
  kymScores: Record<string, { score: number }>;
  kymLoading: boolean;
  normalizeUrl: (url: string) => string;
  globalLoading: boolean;
}) {
  const displayName = useMemo(
    () => getMintDisplayName(mint.url, mint.mintInfo),
    [mint.url, mint.mintInfo]
  );
  const displayMintUrl = mint.url;
  // No balance in add route (matching renderMintItem behavior)
  const balance: { amount: number; unit: string } | undefined = undefined as
    | { amount: number; unit: string }
    | undefined;
  const isLoading = false;
  const onPress = useCallback(() => {
    onToggle(mintUrl);
  }, [onToggle, mintUrl]);
  const showCheckbox = true;
  const showDetailsButton = false;
  const onInspectPress = () => {
    console.log('inspect');
  };

  // Calculate KYM score from props (matching renderMintItem logic)
  const normalizedUrl = useMemo(() => normalizeUrl(mint.url), [mint.url, normalizeUrl]);
  const kymData = kymScores[normalizedUrl];
  const kymScore = kymData?.score;
  const displayScore = kymScore ? kymScore.toString() : undefined;

  // Fetch audit data (matching MintItem logic)
  const { auditInfo, loading: auditLoading } = useAuditedMint(mint.url);

  // Calculate success rate percentage (matching MintItem logic)
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

  // Determine badge variant based on audit state (matching MintItem logic)
  const activityBadgeVariant = useMemo(() => {
    const state = auditInfo?.auditorData?.state;
    if (state === 'ERROR') {
      return 'error';
    }
    // Default to success for OK state or when state is undefined/loading
    return 'success';
  }, [auditInfo?.auditorData?.state]);

  const itemOpacity = 1;
  const { getYellowColor, getGreenColor } = useTheme();
  const opacity = useCallback((color: string, opacity: number) => {
    return color.replace('ff', Math.round(opacity * 255).toString(16)).concat('ff');
  }, []);
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
      disabled={globalLoading}>
      <VStack gap={12}>
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
              {balance !== undefined ? (
                <Badge variant="primary" icon={'material-symbols:currency-bitcoin'} size={14}>
                  {balance.amount}
                </Badge>
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
                  onToggle(mintUrl);
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

        {/* Bottom section: Score and Success Rate badges */}
        <HStack gap={8}>
          {/* Score badge (left) - show skeleton when loading, badge when score available */}
          {!kymLoading && displayScore ? (
            <Badge className="h-[24px] w-[56px]" variant="star" icon="ic:round-star" size={14}>
              {displayScore}
            </Badge>
          ) : (
            <Skeleton
              className="h-[24px] w-[56px] rounded-full"
              style={{
                backgroundColor: opacity(getYellowColor('300'), 0.2),
              }}
            />
          )}

          {/* Success rate badge (right) - show skeleton when loading, badge when data available */}
          {!auditLoading && successRate !== undefined ? (
            <Badge
              className="h-[24px] w-[60px]"
              variant={activityBadgeVariant}
              icon="lucide:activity"
              size={14}>
              {`${successRate}%`}
            </Badge>
          ) : (
            <Skeleton
              className="h-[24px] w-[60px] rounded-full"
              style={{
                backgroundColor: opacity(getGreenColor('300'), 0.2),
              }}
            />
          )}
        </HStack>
      </VStack>
    </TouchableOpacity>
  );
});

export default AddRoute;
