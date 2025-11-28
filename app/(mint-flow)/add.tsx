/**
 * @fileoverview Add Mints screen for Mint Flow
 *
 * PERFORMANCE OPTIMIZED VERSION:
 * - Batch loads audit data for all mints at once (not per-item)
 * - Uses LegendList for virtualized rendering
 * - Proper memoization to prevent re-renders
 * - Removed console.log statements
 */

import React, { useState, useMemo, useCallback, memo } from 'react';
import { TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';
import { View, VStack, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMintManagement, useAuditedMints } from 'hooks/coco';
import { MintSearchInput } from 'components/ui/MintSearchInput';
import { useDebouncedMintValidation } from 'hooks/coco/useDebouncedMintValidation';
import { useNostrDiscoveredMints } from 'hooks/coco/useNostrDiscoveredMints';
import { useSovranDiscoveredMints } from 'hooks/coco/useSovranDiscoveredMints';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { filterMints } from 'helper/fuzzySearch';
import { extractDomain, getMintDisplayName } from 'helper/url';
import { CocoManager } from 'helper/coco/manager';
import { popup } from 'helper/popup';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Skeleton } from 'components/ui/Skeleton';
import { Avatar } from 'components/ui/Avatar';
import { Badge } from 'components/ui/Badge';
import { Checkbox } from 'components/ui/Checkbox';
import { LegendList } from '@legendapp/list';
import Icon, { CurrencyIcon } from 'assets/icons';
import type { AuditedMintData } from 'hooks/coco/useAuditedMints';

interface PseudoMint {
  url: string;
  isPseudoMint: true;
  mintInfo?: any;
  name?: string;
}

interface SearchableDiscoveredMint {
  url: string;
  score: number;
  recommendations: any[];
  mintInfo: any | null;
  name: string;
}

type SearchableMint = SearchableDiscoveredMint | PseudoMint;

const adaptDiscoveredMint = (mint: any): SearchableDiscoveredMint => ({
  ...mint,
  name: mint.mintInfo?.name || extractDomain(mint.url),
});

// Loading skeleton
const LoadingMintsList = memo(function LoadingMintsList({ count = 5 }: { count?: number }) {
  return (
    <VStack spacing={0}>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className="bg-primary-900"
          style={{ padding: 16, marginBottom: 4, borderRadius: 16 }}>
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
});

// Optimized Mint item component - receives all data as props (no hooks inside)
const MintItem = memo(function MintItem({
  mint,
  selected,
  onToggle,
  kymScore,
  kymLoading,
  auditData,
  globalLoading,
}: {
  mint: SearchableMint;
  selected: boolean;
  onToggle: (url: string) => void;
  kymScore?: number;
  kymLoading: boolean;
  auditData: AuditedMintData;
  globalLoading: boolean;
}) {
  const { getYellowColor, getGreenColor } = useTheme();

  const displayName = useMemo(
    () => getMintDisplayName(mint.url, mint.mintInfo),
    [mint.url, mint.mintInfo]
  );

  const onPress = useCallback(() => {
    onToggle(mint.url);
  }, [onToggle, mint.url]);

  const displayScore = kymScore ? kymScore.toString() : undefined;

  // Calculate success rate from audit data
  const successRate = useMemo(() => {
    const auditInfo = auditData.auditInfo;
    if (auditInfo?.score !== undefined) {
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
  }, [auditData.auditInfo]);

  // Determine badge variant based on audit state
  const activityBadgeVariant = useMemo(() => {
    const state = auditData.auditInfo?.auditorData?.state;
    return state === 'ERROR' ? 'error' : 'success';
  }, [auditData.auditInfo?.auditorData?.state]);

  // Helper for opacity color calculation
  const opacityColor = useCallback((color: string, opacityValue: number) => {
    return color.replace('ff', Math.round(opacityValue * 255).toString(16)).concat('ff');
  }, []);

  const auditLoading = auditData.loading;

  return (
    <TouchableOpacity
      className="bg-primary-900"
      style={{
        padding: 16,
        marginBottom: 4,
        borderRadius: 16,
        opacity: 1,
      }}
      onPress={onPress}
      disabled={globalLoading}>
      <VStack gap={12}>
        {/* Top section: Logo, name, URL, checkbox */}
        <HStack align="center" gap={12}>
          <View style={{ position: 'relative' }}>
            <Avatar
              picture={mint.mintInfo?.icon_url || undefined}
              size={42}
              variant="mint"
              name={displayName}
              alt={`${displayName} mint`}
            />
          </View>

          <VStack flex={1}>
            <Text className="text-primary-0" size={16} bold overpass>
              {displayName}
            </Text>

            <View style={{ alignSelf: 'flex-start' }}>
              <Text heavy className="text-primary-300" size={14}>
                {extractDomain(mint.url)}
              </Text>
            </View>
          </VStack>

          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(mint.url)}
            size={24}
            variant="success"
          />
        </HStack>

        {/* Bottom section: Score and Success Rate badges */}
        <HStack gap={8}>
          {/* Score badge */}
          {!kymLoading && displayScore ? (
            <Badge className="h-[24px] w-[56px]" variant="star" icon="ic:round-star" size={14}>
              {displayScore}
            </Badge>
          ) : (
            <Skeleton
              className="h-[24px] w-[56px] rounded-full"
              style={{ backgroundColor: opacityColor(getYellowColor('300'), 0.2) }}
            />
          )}

          {/* Success rate badge */}
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
              style={{ backgroundColor: opacityColor(getGreenColor('300'), 0.2) }}
            />
          )}
        </HStack>
      </VStack>
    </TouchableOpacity>
  );
});

// Currency filter tabs - styled to match MintCurrencySelector
const CurrencyTabs = memo(function CurrencyTabs({
  currencies,
  selected,
  onSelect,
}: {
  currencies: string[];
  selected: string;
  onSelect: (currency: string) => void;
}) {
  const { getPrimaryColor } = useTheme();
  const primaryColor0 = getPrimaryColor('0');
  const primaryColor700 = getPrimaryColor('700');
  const primaryColor900 = getPrimaryColor('900');

  return (
    <VStack>
      <Text size={18} bold overpass className="text-primary-0" style={{ marginBottom: 4 }}>
        Currency options
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1 }}>
        <HStack gap={8}>
          {currencies.map((currency) => (
            <TouchableOpacity
              key={currency}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderRadius: 8,
                minWidth: 100,
                backgroundColor: selected === currency ? primaryColor700 : primaryColor900,
              }}
              onPress={() => onSelect(currency)}>
              <HStack align="center" justify="flex-start" gap={8}>
                {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? (
                  <Icon
                    name={`circle-flags:${currency === 'USD' ? 'us' : currency === 'EUR' ? 'eu' : 'gb'}`}
                    size={32}
                  />
                ) : currency === 'ALL' ? (
                  <Icon name="clarity:internet-of-things-solid" color={primaryColor0} size={32} />
                ) : (
                  <CurrencyIcon width={32} currency={currency.toLowerCase()} />
                )}
                <Text size={14} bold overpass className="text-primary-0">
                  {currency === 'SAT' ? 'BTC' : currency === 'ALL' ? 'ALL' : currency}
                </Text>
              </HStack>
            </TouchableOpacity>
          ))}
        </HStack>
      </ScrollView>
    </VStack>
  );
});

function AddMintsScreen() {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');

  const {
    url,
    setUrl,
    validationState,
    mintInfo: customMintInfo,
  } = useDebouncedMintValidation(800);

  const normalizeUrl = useCallback((u: string): string => u.replace(/\/$/, ''), []);

  const { mints: nostrDiscoveredMints, loading: nostrLoading } = useNostrDiscoveredMints();
  const { mints: sovranDiscoveredMints, loading: sovranLoading } = useSovranDiscoveredMints();

  // Merge and dedupe discovered mints
  const discoveredMints = useMemo(() => {
    const allMints = [...nostrDiscoveredMints, ...sovranDiscoveredMints];
    const seenUrls = new Set<string>();
    const uniqueMints: any[] = [];
    for (const mint of allMints) {
      const norm = normalizeUrl(mint.url);
      if (!seenUrls.has(norm)) {
        seenUrls.add(norm);
        uniqueMints.push(mint);
      }
    }
    return uniqueMints;
  }, [nostrDiscoveredMints, sovranDiscoveredMints, normalizeUrl]);

  const discoveryLoading = nostrLoading || sovranLoading;

  const { mints: knownMints } = useMintManagement();

  // Filter out known mints and apply search
  const filteredMints = useMemo((): SearchableMint[] => {
    const knownMintUrls = new Set(knownMints.map((mint) => normalizeUrl(mint.mintUrl)));
    const searchable = discoveredMints
      .filter((mint) => !knownMintUrls.has(normalizeUrl(mint.url)))
      .map(adaptDiscoveredMint);

    if (!url.trim()) return searchable;

    const filtered = filterMints(searchable, url);
    const normalizedUrl = normalizeUrl(url);
    const urlExists = filtered.some((mint) => normalizeUrl(mint.url) === normalizedUrl);

    if (validationState.isValid === true && customMintInfo !== null && !urlExists) {
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

  // Filter by currency
  const currencyFilteredMints = useMemo(() => {
    if (selectedCurrency === 'ALL') return filteredMints;

    return filteredMints.filter((mint) => {
      if (!mint.mintInfo?.nuts?.['4']?.methods) {
        return selectedCurrency === 'SAT';
      }
      return mint.mintInfo.nuts['4'].methods.some(
        (method: any) => method.unit?.toUpperCase() === selectedCurrency
      );
    });
  }, [filteredMints, selectedCurrency]);

  // Extract available currencies
  const availableCurrencies = useMemo(() => {
    const units: Set<string> = new Set(['SAT']);
    filteredMints.forEach((mint) => {
      if (mint.mintInfo?.nuts?.['4']?.methods) {
        mint.mintInfo.nuts['4'].methods.forEach((method: any) => {
          if (method.unit) {
            units.add(method.unit.toUpperCase());
          }
        });
      }
    });
    const allowed = ['SAT', 'USD', 'EUR', 'GBP'];
    const filtered = [...units].filter((c) => allowed.includes(c));
    return ['ALL', ...filtered];
  }, [filteredMints]);

  // Get all mint URLs for batch loading
  const mintUrls = useMemo(
    () => currencyFilteredMints.map((mint) => mint.url),
    [currencyFilteredMints]
  );

  // Batch load KYM scores
  const { scores: kymScores, loading: kymLoading } = useKYMMints(mintUrls);

  // Batch load audit data (the key optimization!)
  const { getAuditData, loading: auditLoading } = useAuditedMints(mintUrls);

  // Sort mints by success rate and KYM score
  const sortedMints = useMemo((): SearchableMint[] => {
    return [...currencyFilteredMints].sort((a, b) => {
      const auditA = getAuditData(a.url);
      const auditB = getAuditData(b.url);

      // Calculate success rates
      const getSuccessRate = (audit: AuditedMintData) => {
        if (audit.auditInfo?.score !== undefined) {
          return audit.auditInfo.score / 5;
        }
        if (audit.auditInfo?.auditorData) {
          const { mints, melts, errors } = audit.auditInfo.auditorData;
          const totalOps = (mints || 0) + (melts || 0);
          if (totalOps > 0) return 1 - (errors || 0) / totalOps;
        }
        return undefined;
      };

      const successRateA = getSuccessRate(auditA);
      const successRateB = getSuccessRate(auditB);
      const kymScoreA = kymScores[normalizeUrl(a.url)]?.score;
      const kymScoreB = kymScores[normalizeUrl(b.url)]?.score;

      if (successRateA !== undefined && successRateB !== undefined && successRateA !== successRateB)
        return successRateB - successRateA;
      if (successRateA !== undefined && successRateB === undefined) return -1;
      if (successRateB !== undefined && successRateA === undefined) return 1;
      if (kymScoreA !== undefined && kymScoreB !== undefined) return kymScoreB - kymScoreA;
      if (kymScoreA !== undefined) return -1;
      if (kymScoreB !== undefined) return 1;
      return 0;
    });
  }, [currencyFilteredMints, kymScores, getAuditData, normalizeUrl]);

  const handleToggleMint = useCallback((mintUrl: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(mintUrl)) next.delete(mintUrl);
      else next.add(mintUrl);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (selectedMints.size === 0) {
      popup({ message: 'Please select at least one mint to add', type: 'warning' });
      return;
    }
    if (isAdding) return;

    setIsAdding(true);
    try {
      if (!CocoManager.isInitialized()) {
        popup({ message: 'Manager not initialized. Please try again.', type: 'error' });
        setIsAdding(false);
        return;
      }

      const manager = CocoManager.getInstance();
      const results: string[] = [];
      const errors: { mintUrl: string; error: string }[] = [];
      const mintUrlsToAdd = Array.from(selectedMints);

      for (let i = 0; i < mintUrlsToAdd.length; i++) {
        const mintUrl = mintUrlsToAdd[i];
        try {
          await manager.mint.trustMint(mintUrl);
          results.push(mintUrl);
          try {
            await manager.mint.getMintInfo(mintUrl);
          } catch {
            // Non-critical
          }
          if (i < mintUrlsToAdd.length - 1) await new Promise((r) => setTimeout(r, 100));
        } catch (err) {
          errors.push({ mintUrl, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (errors.length === 0) {
        popup({ message: `Successfully added ${results.length} mint(s)`, type: 'success' });
        router.back();
      } else if (results.length > 0) {
        popup({
          message: `Added ${results.length} mint(s), ${errors.length} failed`,
          type: 'warning',
        });
        router.back();
      } else {
        popup({ message: `Failed to add any mints`, type: 'error' });
      }
    } catch {
      popup({ message: `Failed to add mints`, type: 'error' });
    } finally {
      setIsAdding(false);
    }
  };

  // Render item for LegendList
  const renderItem = useCallback(
    ({ item }: { item: SearchableMint }) => {
      const normalizedUrl = normalizeUrl(item.url);
      const kymData = kymScores[normalizedUrl];

      return (
        <MintItem
          mint={item}
          selected={selectedMints.has(item.url)}
          onToggle={handleToggleMint}
          kymScore={kymData?.score}
          kymLoading={kymLoading}
          auditData={getAuditData(item.url)}
          globalLoading={isAdding}
        />
      );
    },
    [selectedMints, handleToggleMint, kymScores, kymLoading, getAuditData, isAdding, normalizeUrl]
  );

  const keyExtractor = useCallback((item: SearchableMint) => item.url, []);

  // Show content as soon as discovery completes, don't wait for audit/kym
  const showContent = !discoveryLoading || discoveredMints.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <Stack.Screen options={{ title: 'Add Mints' }} />
      <View style={{ flex: 1, paddingTop: insets.top + 48, paddingHorizontal: 16 }}>
        <VStack spacing={16} style={{ flex: 1 }}>
          <MintSearchInput value={url} onChangeText={setUrl} validationState={validationState} />

          <CurrencyTabs
            currencies={availableCurrencies}
            selected={selectedCurrency}
            onSelect={setSelectedCurrency}
          />

          <VStack flex={1}>
            <HStack align="center" gap={8} style={{ marginBottom: 4 }}>
              <Text size={18} bold overpass className="text-primary-0">
                {url.trim() ? 'Search results' : 'Discovered mints'}
              </Text>
              {(auditLoading || kymLoading) && showContent && (
                <ActivityIndicator size="small" color={getPrimaryColor('400')} />
              )}
            </HStack>

            {!showContent ? (
              <LoadingMintsList />
            ) : sortedMints.length === 0 ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text className="text-primary-400" size={16}>
                  {url.trim()
                    ? 'No mints found matching your search'
                    : selectedCurrency !== 'ALL'
                      ? `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`
                      : 'No mints available'}
                </Text>
              </View>
            ) : (
              <LegendList
                data={sortedMints}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                extraData={selectedMints}
                estimatedItemSize={120}
                recycleItems={true}
                drawDistance={300}
                style={{ flex: 1, maxHeight: 400 }}
                contentContainerStyle={{ paddingBottom: 16 }}
              />
            )}
          </VStack>
        </VStack>
      </View>
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: isAdding ? 'Adding...' : `Add (${selectedMints.size})`,
              variant: 'primary',
              onPress: handleSave,
              disabled: selectedMints.size === 0 || isAdding,
            },
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => router.back(),
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}

export default withSheetProvider(AddMintsScreen);
