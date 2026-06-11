import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Platform, TextInput, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeaderSearch } from '@/shared/hooks/useHeaderSearch';
import { useDebouncedMintValidation } from '@/features/mint/hooks/useDebouncedMintValidation';
import { useMintSearch } from '@/features/mint/hooks/useMintSearch';
import type { MintSearchResult } from '@/shared/lib/apiClient';
import { useMintProfileStore } from '@/shared/stores/global/mintProfileStore';
import { useMintProfiles } from '@/features/mint/hooks/useMintProfiles';
import {
  extractDomain,
  getMintDisplayName,
  normalizeMintUrlKey,
  normalizeUrlForApi,
} from '@/shared/lib/url';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { staticPopup, paramPopup } from '@/shared/lib/popup';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { ContactRow, mintIdentity } from '@/shared/ui/composed/ContactRow';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import {
  LegendList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from '@legendapp/list/react-native';
import { Screen } from '@/shared/ui/composed/Screen';
import { LoadingIndicator } from '@/shared/blocks/status';
import { MintCurrencyTabs } from '@/features/mint/components/MintCurrencyTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import opacity from 'hex-color-opacity';
import { log, cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';
import type { GetInfoResponse } from '@cashu/cashu-ts';

// Height constant for currency tabs (same as MintListScreen)
const CURRENCY_TABS_HEIGHT = 48;

// MintStatCell removed — stats now rendered inline

interface PseudoMint {
  url: string;
  isPseudoMint: true;
  mintInfo?: GetInfoResponse | null;
  name?: string;
}

interface DisplayMint {
  url: string;
  name: string;
  mintInfo: {
    icon_url?: string | null;
    name?: string;
    description?: string | null;
    /** NUT-06 contact entries — needed by `useMintProfiles` to find the operator's Nostr pubkey. */
    contact?: { method: string; info: string }[];
  } | null;
  contactFollowers?: number;
  contactReputation?: number;
  /** Server-provided audit state for sorting badge color */
  auditState?: string;
  /** Server-provided total operations for stats display */
  serverStats?: { n_mints: number; n_melts: number; n_errors: number };
  /** KYM review score (0-5) */
  reviewScore?: number | null;
  /** Number of KYM reviews */
  reviewCount?: number;
}

type SearchableMint = DisplayMint | PseudoMint;

function adaptSearchResult(result: MintSearchResult): DisplayMint {
  const profile = useMintProfileStore.getState().getCached(result.url);
  const info = (result.info ?? {}) as {
    icon_url?: string | null;
    name?: string;
    description?: string | null;
    contact?: { method: string; info: string }[];
  };
  return {
    url: result.url,
    name: info.name || result.name || extractDomain(result.url),
    mintInfo: {
      icon_url: info.icon_url ?? null,
      name: info.name ?? result.name,
      description: info.description ?? null,
      contact: Array.isArray(info.contact) ? info.contact : undefined,
    },
    contactFollowers: profile?.followers,
    contactReputation:
      profile && typeof profile.reputation === 'number'
        ? Math.round(profile.reputation)
        : undefined,
    auditState: result.state,
    serverStats: {
      n_mints: result.n_mints,
      n_melts: result.n_melts,
      n_errors: result.n_errors,
    },
    reviewScore: result.review_score,
    reviewCount: result.review_count,
  };
}

// Fallback search header for Android with validation state
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
      {(validationState.isLoading || validationState.isValid != null) && (
        <LoadingIndicator
          size={20}
          phase={validationState.isLoading ? 'loading' : 'done'}
          result={validationState.isValid === false ? 'error' : 'success'}
          color={opacity(foreground, 0.4)}
          successColor={green400}
          errorColor={danger}
        />
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

// Pre-baked mint row — deferred to the shared `ContactRow` so search results
// here visually match the mint list, contacts tab, and split-bill picker.
const MintItem = memo(function MintItem({
  mint,
  selected,
  onToggle,
  globalLoading,
}: {
  mint: SearchableMint;
  selected: boolean;
  onToggle: (url: string) => void;
  globalLoading: boolean;
}) {
  const displayName = useMemo(
    () => getMintDisplayName(mint.url, mint.mintInfo),
    [mint.url, mint.mintInfo]
  );

  // Search-result preview only: the search endpoint returns `serverStats`
  // (`n_mints`/`n_melts`/`n_errors`) without the per-swap array, so we can't
  // route through `transformAuditData` like the catalog/info paths do. The
  // resulting score is an ops-aggregate approximation; it can disagree with
  // the swap-based score the user sees once the mint is opened. That's
  // accepted — this pill is best-effort during search; authoritative scores
  // come from `getMintCatalog` and `MintInfoScreen`.
  const { auditScore, auditTotalOps } = useMemo<{
    auditScore: number | undefined;
    auditTotalOps: number | undefined;
  }>(() => {
    if (!('serverStats' in mint) || !mint.serverStats)
      return { auditScore: undefined, auditTotalOps: undefined };
    const { n_mints, n_melts, n_errors } = mint.serverStats;
    const totalOps = n_mints + n_melts;
    if (totalOps <= 0) return { auditScore: undefined, auditTotalOps: undefined };
    const successRate = 1 - n_errors / totalOps; // 0..1
    return { auditScore: successRate * 5, auditTotalOps: totalOps };
  }, [mint]);

  return (
    <ContactRow
      identity={mintIdentity({
        mintUrl: mint.url,
        displayName,
        iconUrl: mint.mintInfo?.icon_url ?? undefined,
        stats: {
          kymScore:
            'reviewScore' in mint && typeof mint.reviewScore === 'number'
              ? mint.reviewScore
              : undefined,
          reviewCount:
            'reviewCount' in mint && typeof mint.reviewCount === 'number'
              ? mint.reviewCount
              : undefined,
          auditScore,
          auditState: 'auditState' in mint ? mint.auditState : undefined,
          auditTotalOps,
          contactReputation: 'contactReputation' in mint ? mint.contactReputation : undefined,
          contactFollowers: 'contactFollowers' in mint ? mint.contactFollowers : undefined,
        },
      })}
      subtitle={extractDomain(mint.url)}
      selectable
      selected={selected}
      onToggle={() => onToggle(mint.url)}
      selectionVariant="checkbox"
      disabled={globalLoading}
      testID={`contact-row:mint:${mint.url}`}
    />
  );
});

export function MintAddScreen() {
  useLifecycleLogger('MintAddScreen');
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const { width: windowWidth } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(windowWidth);

  // Scroll tracking for animated currency tabs
  const scrollY = useSharedValue(0);

  // Track header height from Screen
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('ALL');

  // Search toggle (matches contacts page pattern)
  const { isSearching, searchQuery, clearKey, onOpenSearch, onCloseSearch, onSearchChange } =
    useHeaderSearch();

  // URL validation fallback — only triggers when input looks like a URL
  const {
    url: validatedUrl,
    setUrl: setValidationUrl,
    validationState,
    mintInfo: customMintInfo,
  } = useDebouncedMintValidation(800);

  // Feed search query into URL validation when it looks like a URL
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.includes('.') || q.startsWith('http')) {
      cashuLog.debug('mint.add.url_validation.trigger', { query: q });
      setValidationUrl(q);
    } else {
      setValidationUrl('');
    }
  }, [searchQuery, setValidationUrl]);

  // Log validation state changes
  useEffect(() => {
    if (validationState.isLoading) {
      cashuLog.debug('mint.add.url_validation.loading');
    } else if (validationState.isValid === true) {
      cashuLog.info('mint.add.url_validation.valid', {
        url: validatedUrl,
        hasIcon: !!customMintInfo?.icon_url,
        name: customMintInfo?.name,
      });
    } else if (validationState.isValid === false) {
      cashuLog.debug('mint.add.url_validation.invalid', { url: validatedUrl });
    }
  }, [validationState, validatedUrl, customMintInfo]);

  // Server-side mint search
  const { results: searchResults, loading: searchLoading } = useMintSearch(
    searchQuery,
    selectedCurrency
  );

  // Hold a skeleton until the discovered list stops changing for 500ms.
  // Individual fetchMintInfo calls resolve at different times, causing the list
  // to shift as mints pop in one-by-one. This waits for them to settle.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), 500);
    return () => clearTimeout(timer);
  }, [searchResults]);

  const { mints: knownMints } = useMintManagement();

  // Subscribe to the mint-profile cache so that when `useMintProfiles` finishes
  // resolving an operator's Nostr profile, `adaptSearchResult` re-runs and the
  // row picks up `contactFollowers` / `contactReputation`.
  const mintProfileCache = useMintProfileStore((s) => s.cache);

  // Adapt server results to display format, filter out already-known mints
  const displayMints = useMemo((): SearchableMint[] => {
    const t0 = performance.now();
    const knownMintUrls = new Set(knownMints.map((mint) => normalizeMintUrlKey(mint.mintUrl)));
    const filteredOut = searchResults.filter((r) => knownMintUrls.has(normalizeMintUrlKey(r.url)));
    const adapted = searchResults
      .filter((r) => !knownMintUrls.has(normalizeMintUrlKey(r.url)))
      .map(adaptSearchResult);

    let hasPseudo = false;

    // If searching with a URL-like query that validated as a mint, prepend it
    if (searchQuery.trim() && validationState.isValid === true && customMintInfo !== null) {
      const apiUrl = normalizeUrlForApi(searchQuery);
      const normalizedInput = normalizeMintUrlKey(apiUrl);
      const alreadyInResults = adapted.some((m) => normalizeMintUrlKey(m.url) === normalizedInput);
      if (!alreadyInResults && !knownMintUrls.has(normalizedInput)) {
        const pseudoMint: PseudoMint = {
          url: apiUrl,
          isPseudoMint: true,
          mintInfo: customMintInfo,
          name: extractDomain(apiUrl),
        };
        hasPseudo = true;
        const result = [pseudoMint, ...adapted];
        const duration = Math.round((performance.now() - t0) * 100) / 100;
        cashuLog.debug('mint.add.display_mints.compute', {
          serverResults: searchResults.length,
          knownFiltered: filteredOut.length,
          displayed: result.length,
          hasPseudoMint: true,
          withIcons: adapted.filter((m) => m.mintInfo?.icon_url).length,
          duration_ms: duration,
        });
        return result;
      }
    }

    const duration = Math.round((performance.now() - t0) * 100) / 100;
    cashuLog.debug('mint.add.display_mints.compute', {
      serverResults: searchResults.length,
      knownFiltered: filteredOut.length,
      displayed: adapted.length,
      hasPseudoMint: hasPseudo,
      withIcons: adapted.filter((m) => m.mintInfo?.icon_url).length,
      duration_ms: duration,
    });
    return adapted;
  }, [searchResults, knownMints, searchQuery, validationState, customMintInfo, mintProfileCache]);

  // Kick off Nostr profile fetches for any search result that has an operator
  // pubkey in NUT-06 contact info. Results land in `useMintProfileStore`
  // and the memo above re-runs once they arrive.
  const profileFetchInputs = useMemo(
    () => displayMints.map((m) => ({ url: m.url, mintInfo: m.mintInfo })),
    [displayMints]
  );
  useMintProfiles(profileFetchInputs);

  // Extract available currencies from results
  const availableCurrencies = useMemo(() => {
    const units = new Set<string>(['SAT']);
    for (const result of searchResults) {
      for (const unit of result.supported_units) {
        units.add(unit.toUpperCase());
      }
    }
    const allowed = ['SAT', 'USD', 'EUR', 'GBP'];
    const currencies = ['ALL', ...[...units].filter((c) => allowed.includes(c))];
    cashuLog.debug('mint.add.currencies.extracted', {
      currencies,
      resultCount: searchResults.length,
    });
    return currencies;
  }, [searchResults]);

  const handleToggleMint = useCallback((mintUrl: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(mintUrl);
      if (wasSelected) {
        next.delete(mintUrl);
      } else {
        next.add(mintUrl);
      }
      cashuLog.debug('mint.add.item.toggle', {
        mintUrl: normalizeMintUrlKey(mintUrl),
        selected: !wasSelected,
        totalSelected: next.size,
      });
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedMints.size === 0) {
      staticPopup('no-mints-selected');
      return;
    }
    if (isAdding) return;

    log.info('mint.add.batch.start', { count: selectedMints.size });
    setIsAdding(true);
    try {
      if (!CocoManager.isInitialized()) {
        log.error('mint.add.batch.manager_not_initialized');
        staticPopup('manager-not-initialized');
        setIsAdding(false);
        return;
      }

      const manager = CocoManager.getInstance();
      const results: string[] = [];
      const errors: { mintUrl: string; error: string }[] = [];

      // Normalize all URLs to ensure https:// prefix before adding.
      // normalizeUrlForApi strips any http(s)?:// prefix and re-prepends https://,
      // so plaintext-http URLs from the search backend can't bypass the upgrade.
      const mintUrlsToAdd = Array.from(selectedMints).map(normalizeUrlForApi);

      for (let i = 0; i < mintUrlsToAdd.length; i++) {
        const mintUrl = mintUrlsToAdd[i];
        const itemT0 = performance.now();
        log.debug('mint.add.item.adding', { index: i + 1, total: mintUrlsToAdd.length, mintUrl });
        try {
          await manager.mint.addMint(mintUrl, { trusted: true });
          const addDuration = Math.round(performance.now() - itemT0);
          log.info('mint.add.item.added', { mintUrl, duration_ms: addDuration });
          results.push(mintUrl);

          // Restore proofs for the newly added mint
          try {
            const restoreT0 = performance.now();
            await manager.wallet.restore(mintUrl);
            log.info('mint.add.restore.success', {
              mintUrl,
              duration_ms: Math.round(performance.now() - restoreT0),
            });
          } catch (restoreErr) {
            log.warn('mint.add.restore.failed', {
              mintUrl,
              error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
            });
          }

          if (i < mintUrlsToAdd.length - 1) {
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch (err) {
          log.error('mint.add.item.failed', {
            mintUrl,
            duration_ms: Math.round(performance.now() - itemT0),
            error: err instanceof Error ? err.message : String(err),
          });
          errors.push({ mintUrl, error: err instanceof Error ? err.message : String(err) });
        }
      }

      log.info('mint.add.batch.complete', { added: results.length, failed: errors.length });
      // Give the MintProvider's `mint:added` listener a tick to refetch
      // `trustedMints` before we pop back. Without this delay the parent
      // Mint List screen sometimes refocuses before the new mint is in
      // its `useMints()` snapshot, leaving the row missing until the next
      // background tick.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (errors.length === 0) {
        paramPopup('mints-added', { added: results.length });
        router.back();
      } else if (results.length > 0) {
        paramPopup('mints-added', { added: results.length, failed: errors.length });
        router.back();
      } else {
        staticPopup('mints-add-failed');
      }
    } catch {
      log.error('mint.add.batch.unexpected_error');
      staticPopup('mints-add-failed');
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
    ({ item }: { item: SearchableMint }) => (
      <MintItem
        mint={item}
        selected={selectedMints.has(item.url)}
        onToggle={handleToggleMint}
        globalLoading={isAdding}
      />
    ),
    [selectedMints, handleToggleMint, isAdding]
  );

  const keyExtractor = useCallback((item: SearchableMint) => item.url, []);

  const showContent = !searchLoading || displayMints.length > 0;

  // Log list render state for performance analysis
  useEffect(() => {
    cashuLog.debug('mint.add.list.render', {
      showContent,
      searchLoading,
      itemCount: displayMints.length,
      isSearching,
      searchQuery: searchQuery.trim() ? searchQuery : undefined,
      selectedCurrency,
      selectedCount: selectedMints.size,
    });
  }, [
    showContent,
    searchLoading,
    displayMints.length,
    isSearching,
    searchQuery,
    selectedCurrency,
    selectedMints.size,
  ]);

  // ── Header: search icon toggle (matches contacts pattern) ──────────────

  // Stable header callbacks — must not swap between string title and render function,
  // otherwise React Navigation caches the old form. Always use render functions.
  const renderHeaderTitle = useCallback(
    () =>
      isSearching ? (
        Platform.OS === 'ios' ? (
          <GlassSearchBar
            width={searchBarWidth}
            onChangeText={onSearchChange}
            clearKey={clearKey}
            placeholder="Search mints or enter URL..."
            keyboardType="url"
            debounceMs={300}
            autoFocus
          />
        ) : (
          <FallbackSearchHeader
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            validationState={validationState}
          />
        )
      ) : (
        <Text className="text-foreground" size={17} bold>
          Add Mints
        </Text>
      ),
    [isSearching, searchBarWidth, onSearchChange, clearKey, searchQuery, validationState]
  );

  // ScreenHeaderAction + monicon glyphs (not IconSymbol/SF Symbols —
  // expo-symbols renders nothing on Android, which left this button invisible
  // there).
  const renderHeaderRight = useCallback(
    () =>
      isSearching ? (
        <ScreenHeaderAction
          icon="material-symbols:close-rounded"
          size={20}
          color={foreground}
          onPress={onCloseSearch}
        />
      ) : (
        <ScreenHeaderAction
          icon="material-symbols:search-rounded"
          size={20}
          color={foreground}
          onPress={onOpenSearch}
        />
      ),
    [isSearching, onCloseSearch, onOpenSearch, foreground]
  );

  const screenOptions = useMemo(
    () => ({
      headerTransparent: true as const,
      headerStyle: { backgroundColor: 'transparent' },
      headerTitle: renderHeaderTitle,
      headerRight: renderHeaderRight,
    }),
    [renderHeaderTitle, renderHeaderRight]
  );

  // ── Sticky content & bottom ────────────────────────────────────────────

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
          {searchQuery.trim()
            ? 'No mints found matching your search'
            : selectedCurrency === 'ALL'
              ? 'No mints available'
              : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
        </Text>
      </View>
    ),
    [searchQuery, selectedCurrency]
  );

  return (
    <Screen
      name="MintAddScreen"
      headerGradient
      stickyContent={currencyTabs}
      stickyContentHeight={CURRENCY_TABS_HEIGHT}
      scroll="custom"
      onHeaderHeightChange={setTotalHeaderHeight}
      footer={bottomButtons}
      bgColor={surface}
      // Renders an autoFocus mint-URL input; mount synchronously so the
      // keyboard opens without racing the modal slide-in.
      deferContent={false}>
      <Stack.Screen options={screenOptions} />
      <Spacer size={16} />
      {!showContent ? (
        <View className="flex-1 px-4" style={{ paddingTop: totalHeaderHeight }}>
          <LoadingMintsList />
        </View>
      ) : (
        <LegendList
          data={displayMints}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={selectedMints}
          estimatedItemSize={120}
          recycleItems
          drawDistance={300}
          style={{ flex: 1, height: 0 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyComponent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />
      )}
    </Screen>
  );
}
