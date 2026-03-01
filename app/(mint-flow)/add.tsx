import React, { useState, useMemo, useCallback, memo, useRef, useEffect } from 'react';
import {
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  useWindowDimensions,
  InteractionManager,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useDebouncedMintValidation } from 'hooks/coco/useDebouncedMintValidation';
import { useNostrDiscoveredMints } from 'hooks/coco/useNostrDiscoveredMints';
import { useSovranDiscoveredMints } from 'hooks/coco/useSovranDiscoveredMints';
import { useKYMMints } from 'hooks/coco/useKYMMints';
import { filterMints } from 'helper/fuzzySearch';
import {
  extractDomain,
  getMintDisplayName,
  normalizeMintUrlKey,
  normalizeUrlForApi,
} from 'helper/url';
import { CocoManager } from 'helper/coco/manager';
import {
  noMintsSelectedPopup,
  managerNotInitializedPopup,
  mintsAddFailedPopup,
  mintsAddedPopup,
} from '@/helper/popup';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Skeleton } from 'components/ui/Skeleton';
import { Avatar } from 'components/ui/Avatar';
import { Badge } from 'components/ui/Badge';
import { Checkbox } from 'components/ui/Checkbox';
import { LegendList, type NativeScrollEvent, type NativeSyntheticEvent } from '@legendapp/list';
import { ModalLayoutWrapper } from 'app/debugModal';
import { MintCurrencyTabs } from 'components/blocks/sheets/mint-balance/MintCurrencyTabs';
import { Host, TextField, VStack as SwiftUIVStack } from '@expo/ui/swift-ui';
import { foregroundStyle, frame, padding, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuditedMints, type AuditedMintData } from 'hooks/coco/useAuditedMints';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import opacity from 'hex-color-opacity';

// Height constant for currency tabs (same as MintListScreen)
const CURRENCY_TABS_HEIGHT = 48;

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

// Native search header for iOS with liquid glass effect
// Uses internal state with debouncing to prevent parent re-renders during typing
// which would cause the SwiftUI TextField to lose focus
const NativeSearchHeader = memo(function NativeSearchHeader({
  width,
  onSearchChange,
  clearKey,
}: {
  width: number;
  onSearchChange: (text: string) => void;
  clearKey: number;
}) {
  const foreground = useThemeColor('foreground');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChangeRef = useRef(onSearchChange);
  const latestTextRef = useRef('');

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  const handleTextChange = useCallback((text: string) => {
    latestTextRef.current = text;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        onSearchChangeRef.current(latestTextRef.current);
      });
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <View className="items-center">
      <Host style={{ zIndex: 10, height: 44, width }} matchContents={false}>
        <SwiftUIVStack
          modifiers={[
            padding({ horizontal: 12, vertical: 8 }),
            frame({ width, height: 44, alignment: 'center' }),
            glassEffect(),
          ]}>
          <TextField
            key={clearKey}
            defaultValue=""
            placeholder="Search mints or enter URL..."
            onChangeText={handleTextChange}
            keyboardType="url"
            autocorrection={false}
            modifiers={[
              foregroundStyle(foreground),
              frame({ maxWidth: Infinity, height: 28, alignment: 'leading' }),
            ]}
          />
        </SwiftUIVStack>
      </Host>
    </View>
  );
});

// Fallback search header for Android
const FallbackSearchHeader = memo(function FallbackSearchHeader({
  searchQuery,
  onSearchChange,
  validationState,
  onFocus,
  onBlur,
}: {
  searchQuery: string;
  onSearchChange: (text: string) => void;
  validationState: {
    isValid: boolean | null;
    isLoading: boolean;
    error: string | null;
  };
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [foreground, defaultColor, surfaceSecondary] = useThemeColor([
    'foreground',
    'default',
    'surface-secondary',
  ] as const);
  const [green400, danger] = useThemeColor(['green-400', 'danger'] as const);

  const getStatusColor = () => {
    if (validationState.isLoading) return opacity(foreground, 0.4);
    if (validationState.isValid === true) return green400;
    if (validationState.isValid === false) return danger;
    return defaultColor;
  };

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: surfaceSecondary,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: getStatusColor(),
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
      }}>
      <TextInput
        value={searchQuery}
        onChangeText={onSearchChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search mints or enter URL..."
        placeholderTextColor={opacity(foreground, 0.33)}
        style={{
          flex: 1,
          color: foreground,
          fontSize: 16,
          fontFamily: 'OxygenRegular',
        }}
        keyboardType="url"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {validationState.isLoading && (
        <ActivityIndicator size="small" color={opacity(foreground, 0.4)} />
      )}
      {!validationState.isLoading && validationState.isValid === true && (
        <Text size={16} style={{ color: green400 }}>
          ✓
        </Text>
      )}
      {!validationState.isLoading && validationState.isValid === false && (
        <Text size={16} style={{ color: danger }}>
          ✗
        </Text>
      )}
    </View>
  );
});

// Loading skeleton
const LoadingMintsList = memo(function LoadingMintsList({ count = 5 }: { count?: number }) {
  return (
    <VStack spacing={0}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} className="bg-surface mb-1 rounded-2xl p-4">
          <VStack gap={12}>
            <View className="flex-row items-center gap-3">
              <Skeleton
                className="bg-surface-tertiary h-[42px] w-[42px]"
                style={{ borderRadius: 42 * 0.25 }}
              />
              <VStack flex={1} gap={8}>
                <Skeleton className="bg-surface-tertiary h-[16px]" style={{ width: 150 }} />
                <Skeleton
                  className="bg-surface-tertiary h-[20px] rounded-full"
                  style={{ width: 80 }}
                />
              </VStack>
            </View>
            <View className="flex-row gap-2">
              <Skeleton
                className="bg-surface-tertiary h-[24px] rounded-full"
                style={{ width: 56 }}
              />
              <Skeleton
                className="bg-surface-tertiary h-[24px] rounded-full"
                style={{ width: 60 }}
              />
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
  const foreground = useThemeColor('foreground');
  const [warning, success] = useThemeColor(['yellow-300', 'success'] as const);

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

  const auditLoading = auditData.loading;

  return (
    <TouchableOpacity
      className="bg-surface mb-1 rounded-2xl p-4"
      onPress={onPress}
      disabled={globalLoading}>
      <VStack gap={12}>
        <HStack align="center" gap={12}>
          <Avatar
            picture={mint.mintInfo?.icon_url || undefined}
            size={42}
            variant="mint"
            name={displayName}
            alt={`${displayName} mint`}
          />

          <VStack flex={1}>
            <Text className="text-foreground" size={16} bold>
              {displayName}
            </Text>

            <View className="self-start">
              <Text heavy size={14} style={{ color: opacity(foreground, 0.5) }}>
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
          {displayScore ? (
            <Badge className="h-[24px] w-[56px]" variant="star" icon="ic:round-star" size={14}>
              {displayScore}
            </Badge>
          ) : kymLoading ? (
            <Skeleton
              className="h-[24px] w-[56px] rounded-full"
              style={{ backgroundColor: opacity(warning, 0.2) }}
            />
          ) : null}

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
              style={{ backgroundColor: opacity(success, 0.2) }}
            />
          ) : null}
        </HStack>
      </VStack>
    </TouchableOpacity>
  );
});

function AddMintsScreen() {
  const foreground = useThemeColor('foreground');
  const { width: windowWidth } = useWindowDimensions();

  // Scroll tracking for animated currency tabs
  const scrollY = useSharedValue(0);

  // Track header height from ModalLayoutWrapper
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');
  const [clearKey, setClearKey] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);

  const {
    url,
    setUrl,
    validationState,
    mintInfo: customMintInfo,
  } = useDebouncedMintValidation(800);

  const { mints: nostrDiscoveredMints, loading: nostrLoading } = useNostrDiscoveredMints();
  const { mints: sovranDiscoveredMints, loading: sovranLoading } = useSovranDiscoveredMints();

  // Merge and dedupe discovered mints
  const discoveredMints = useMemo(() => {
    const allMints = [...nostrDiscoveredMints, ...sovranDiscoveredMints];
    const seenUrls = new Set<string>();
    const uniqueMints: any[] = [];
    for (const mint of allMints) {
      const norm = normalizeMintUrlKey(mint.url);
      if (!seenUrls.has(norm)) {
        seenUrls.add(norm);
        uniqueMints.push(mint);
      }
    }
    return uniqueMints;
  }, [nostrDiscoveredMints, sovranDiscoveredMints]);

  const discoveryLoading = nostrLoading || sovranLoading;

  const { mints: knownMints } = useMintManagement();

  // Filter out known mints and apply search
  const filteredMints = useMemo((): SearchableMint[] => {
    const knownMintUrls = new Set(knownMints.map((mint) => normalizeMintUrlKey(mint.mintUrl)));
    const searchable = discoveredMints
      .filter((mint) => !knownMintUrls.has(normalizeMintUrlKey(mint.url)))
      .map(adaptDiscoveredMint);

    if (!url.trim()) return searchable;

    const filtered = filterMints(searchable, url);
    const normalizedUrl = normalizeMintUrlKey(url);
    const urlExists = filtered.some((mint) => normalizeMintUrlKey(mint.url) === normalizedUrl);

    if (validationState.isValid === true && customMintInfo !== null && !urlExists) {
      // Use normalized URL with https:// for the mint
      const apiUrl = normalizeUrlForApi(url);
      const pseudoMint: PseudoMint = {
        url: apiUrl,
        isPseudoMint: true,
        mintInfo: customMintInfo,
        name: extractDomain(apiUrl),
      };
      return [pseudoMint, ...filtered];
    }

    return filtered;
  }, [discoveredMints, knownMints, url, customMintInfo, validationState]);

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
  const { getAuditData } = useAuditedMints(mintUrls);

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
      const kymScoreA = kymScores[normalizeMintUrlKey(a.url)]?.score;
      const kymScoreB = kymScores[normalizeMintUrlKey(b.url)]?.score;

      if (successRateA !== undefined && successRateB !== undefined && successRateA !== successRateB)
        return successRateB - successRateA;
      if (successRateA !== undefined && successRateB === undefined) return -1;
      if (successRateB !== undefined && successRateA === undefined) return 1;
      if (kymScoreA !== undefined && kymScoreB !== undefined) return kymScoreB - kymScoreA;
      if (kymScoreA !== undefined) return -1;
      if (kymScoreB !== undefined) return 1;
      return 0;
    });
  }, [currencyFilteredMints, kymScores, getAuditData]);

  const handleToggleMint = useCallback((mintUrl: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(mintUrl)) {
        next.delete(mintUrl);
      } else {
        next.add(mintUrl);
      }
      return next;
    });
  }, []);

  const handleSearchChange = useCallback(
    (text: string) => {
      setUrl(text);
    },
    [setUrl]
  );

  const handleClearSearch = useCallback(() => {
    setUrl('');
    setClearKey((prev) => prev + 1);
  }, [setUrl]);

  const handleInputFocus = useCallback(() => {
    setIsInputFocused(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    setIsInputFocused(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedMints.size === 0) {
      noMintsSelectedPopup();
      return;
    }
    if (isAdding) return;

    setIsAdding(true);
    try {
      if (!CocoManager.isInitialized()) {
        managerNotInitializedPopup();
        setIsAdding(false);
        return;
      }

      const manager = CocoManager.getInstance();
      const results: string[] = [];
      const errors: { mintUrl: string; error: string }[] = [];

      // Normalize all URLs to ensure https:// prefix before adding
      const mintUrlsToAdd = Array.from(selectedMints).map((u) =>
        u.startsWith('https://') || u.startsWith('http://') ? u : normalizeUrlForApi(u)
      );

      for (let i = 0; i < mintUrlsToAdd.length; i++) {
        const mintUrl = mintUrlsToAdd[i];
        try {
          await manager.mint.addMint(mintUrl, { trusted: true });
          results.push(mintUrl);

          // Pre-fetch mint info (non-critical)
          try {
            await manager.mint.getMintInfo(mintUrl);
          } catch {
            // Non-critical
          }

          if (i < mintUrlsToAdd.length - 1) {
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch (err) {
          errors.push({ mintUrl, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (errors.length === 0) {
        mintsAddedPopup({ added: results.length });
        router.back();
      } else if (results.length > 0) {
        mintsAddedPopup({ added: results.length, failed: errors.length });
        router.back();
      } else {
        mintsAddFailedPopup();
      }
    } catch {
      mintsAddFailedPopup();
    } finally {
      setIsAdding(false);
    }
  }, [selectedMints, isAdding]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchableMint }) => {
      const normalizedUrl = normalizeMintUrlKey(item.url);
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
    [selectedMints, handleToggleMint, kymScores, kymLoading, getAuditData, isAdding]
  );

  const keyExtractor = useCallback((item: SearchableMint) => item.url, []);

  const showContent = !discoveryLoading || discoveredMints.length > 0;
  const isSearching = url.trim().length > 0;
  const showCancelButton = isInputFocused || isSearching;

  const headerWidth = windowWidth - 124 - 24;

  // Sticky currency tabs
  const currencyTabs = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={setSelectedCurrency}
        scrollY={scrollY}
      />
    ),
    [availableCurrencies, selectedCurrency, setSelectedCurrency, scrollY]
  );

  const bottomButtons = useMemo(
    () => (
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
    ),
    [isAdding, selectedMints.size, handleSave]
  );

  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  const emptyComponent = useMemo(
    () => (
      <View className="items-center pt-5">
        <Text className="text-foreground text-center">
          {url.trim()
            ? 'No mints found matching your search'
            : selectedCurrency === 'ALL'
              ? 'No mints available'
              : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
        </Text>
      </View>
    ),
    [url, selectedCurrency]
  );

  const iosHeaderTitle = useMemo(
    () => (
      <NativeSearchHeader
        width={headerWidth}
        onSearchChange={handleSearchChange}
        clearKey={clearKey}
      />
    ),
    [headerWidth, handleSearchChange, clearKey]
  );

  const androidHeaderTitle = useMemo(
    () => (
      <FallbackSearchHeader
        searchQuery={url}
        onSearchChange={handleSearchChange}
        validationState={validationState}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
      />
    ),
    [url, handleSearchChange, validationState, handleInputFocus, handleInputBlur]
  );

  const headerRightButton = useMemo(
    () =>
      showCancelButton ? (
        <TouchableOpacity onPress={handleClearSearch} style={{ padding: 8 }}>
          <IconSymbol name="xmark" size={20} color={foreground} />
        </TouchableOpacity>
      ) : null,
    [showCancelButton, handleClearSearch, foreground]
  );

  const renderHeaderTitle = useCallback(
    () => (Platform.OS === 'ios' ? iosHeaderTitle : androidHeaderTitle),
    [iosHeaderTitle, androidHeaderTitle]
  );

  const renderHeaderRight = useCallback(() => headerRightButton, [headerRightButton]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Add Mints',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTitle: renderHeaderTitle,
          headerRight: renderHeaderRight,
        }}
      />

      <ModalLayoutWrapper
        headerGradient
        stickyContent={currencyTabs}
        stickyContentHeight={CURRENCY_TABS_HEIGHT}
        useCustomScrollView
        onHeaderHeightChange={setTotalHeaderHeight}
        bottomContent={bottomButtons}>
        <Spacer size={16} />
        {!showContent ? (
          <View className="flex-1 px-4" style={{ paddingTop: totalHeaderHeight }}>
            <LoadingMintsList />
          </View>
        ) : (
          <LegendList
            data={sortedMints}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            extraData={selectedMints}
            estimatedItemSize={120}
            recycleItems
            drawDistance={300}
            style={{ flex: 1, height: 0 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyComponent}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          />
        )}
      </ModalLayoutWrapper>
    </>
  );
}

export default withSheetProvider(AddMintsScreen);
