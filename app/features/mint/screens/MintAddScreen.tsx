import { accountUnitLabel } from 'wallet';
import { useState, useMemo, useEffect } from 'react';
import { Platform, TextInput, useWindowDimensions } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Stack, useLocalSearchParams } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeaderSearch } from '@/shared/hooks/useHeaderSearch';
import { useDebouncedMintValidation } from '@/features/mint/hooks/useDebouncedMintValidation';
import { useMintSearch } from '@/features/mint/hooks/useMintSearch';
import { selectMintAudit, type MintAuditSummary } from '@/features/mint/lib/auditInfo';
import { extractAvailableCurrencies } from '@/features/mint/lib/availableCurrencies';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { Button } from '@/shared/ui/primitives/Button';
import type { MintSearchResult } from '@/shared/lib/apiClient';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useMintProfiles } from '@/features/mint/hooks/useMintProfiles';
import {
  extractDomain,
  getMintDisplayName,
  normalizeMintUrlKey,
  normalizeUrlForApi,
} from '@/shared/lib/url';
import { useMintImport } from '@/features/mint/hooks/useMintImport';
import { staticPopup } from '@/shared/lib/popup';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { ContactRow, mintIdentity } from '@/shared/ui/composed/ContactRow';
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { List } from '@/shared/ui/composed/List';
import { Screen } from '@/shared/ui/composed/Screen';
import { LoadingIndicator } from '@/shared/blocks/status';
import { MINT_CURRENCY_TABS_HEIGHT } from '@/features/mint/components/MintCurrencyTabs';
import { useStickyCurrencyTabs } from '@/features/mint/hooks/useStickyCurrencyTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { withAlpha } from '@/shared/lib/color';
import { cashuLog, useLifecycleLogger, mintUrlLogFields } from '@/shared/lib/logger';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';
import type { GetInfoResponse } from '@cashu/cashu-ts';

// Height constant for currency tabs (same as MintListScreen)
const CURRENCY_TABS_HEIGHT = MINT_CURRENCY_TABS_HEIGHT;

// MintStatCell removed — stats now rendered inline

interface PseudoMint {
  url: string;
  isPseudoMint: true;
  mintInfo?: GetInfoResponse | null;
  name?: string;
}

/**
 * Placeholder fed to the result `List` while the first search is in flight. It
 * flows through the same `MintItem` → `ContactRow` path as real rows (in loading
 * mode), so the skeleton can't drift from real-row height. The `url` is a stable
 * synthetic key that also seeds the deterministic placeholder widths.
 */
interface SkeletonMint {
  url: string;
  isSkeleton: true;
}

const noop = () => {};

const keyExtractor = (item: SearchableMint) => item.url;
const getItemType = (item: SearchableMint) => ('isSkeleton' in item ? 'skeleton' : 'mint');

/** Stable placeholder rows for the initial-search loading state. Fixed identity
 *  so FlashList keys are stable and each row's seeded placeholder width holds. */
const SKELETON_MINTS: SkeletonMint[] = Array.from({ length: 5 }, (_, i) => ({
  url: `skeleton-${i}`,
  isSkeleton: true,
}));

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
  /** The audit pill's numbers, read the same way the mint info page reads them. */
  audit?: MintAuditSummary;
  /** KYM review score (0-5) */
  reviewScore?: number | null;
  /** Number of KYM reviews */
  reviewCount?: number;
}

type SearchableMint = DisplayMint | PseudoMint | SkeletonMint;

function adaptSearchResult(result: MintSearchResult): DisplayMint {
  const profile = useMintMetadataStore.getState().getCached(result.url);
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
    contactFollowers: profile?.contactFollowers,
    contactReputation:
      profile && typeof profile.contactReputation === 'number'
        ? Math.round(profile.contactReputation)
        : undefined,
    // The metadata store is seeded from this same discover response and is
    // what the mint info page reads, so it wins; the row's own counts cover a
    // mint the store has evicted.
    audit:
      selectMintAudit(profile) ??
      selectMintAudit({
        auditState: result.state,
        nMints: result.n_mints,
        nMelts: result.n_melts,
        nErrors: result.n_errors,
      }),
    reviewScore: result.review_score,
    reviewCount: result.review_count,
  };
}

// Fallback search header for Android with validation state
function FallbackSearchHeader({
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
    if (validationState.isLoading) return withAlpha(foreground, 0.4);
    if (validationState.isValid === true) return green400;
    if (validationState.isValid === false) return danger;
    return defaultColor;
  };

  return (
    <View
      style={{
        flex: 1,
        // FlowSheetHeader's titleSlot is a centered column (alignItems
        // 'center' disables cross-axis stretch), so without an explicit
        // stretch this collapses to padding-only width — the 'malformed,
        // no width' search bar.
        alignSelf: 'stretch',
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
        testID="mint-add-search-input"
        value={searchQuery}
        onChangeText={onSearchChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search mints or enter URL..."
        placeholderTextColor={withAlpha(foreground, 0.33)}
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
          color={withAlpha(foreground, 0.4)}
          successColor={green400}
          errorColor={danger}
        />
      )}
    </View>
  );
}

// Pre-baked mint row — deferred to the shared `ContactRow` so search results
// here visually match the mint list, contacts tab, and split-bill picker.
//
// `loading` renders the row in skeleton mode through the SAME `ContactRow`, so
// the loading placeholder and the real row share every layout box (avatar,
// title, subtitle, stats accent, checkbox) and can't drift in height. The mint
// fields are read defensively because skeleton items carry only a synthetic
// `url`; their values are never shown (loading swaps in placeholder bars).
function MintItem({
  mint,
  selected,
  onToggle,
  globalLoading,
  loading,
}: {
  mint: SearchableMint;
  selected: boolean;
  onToggle: (url: string) => void;
  globalLoading: boolean;
  loading?: boolean;
}) {
  const mintInfo = 'mintInfo' in mint ? mint.mintInfo : undefined;
  const displayName = getMintDisplayName(mint.url, mintInfo);
  const audit = 'audit' in mint ? mint.audit : undefined;

  return (
    <ContactRow
      loading={loading}
      identity={mintIdentity({
        mintUrl: mint.url,
        displayName,
        iconUrl: mintInfo?.icon_url ?? undefined,
        stats: {
          kymScore:
            'reviewScore' in mint && typeof mint.reviewScore === 'number'
              ? mint.reviewScore
              : undefined,
          reviewCount:
            'reviewCount' in mint && typeof mint.reviewCount === 'number'
              ? mint.reviewCount
              : undefined,
          auditScore: audit?.score,
          auditState: audit?.state,
          auditTotalOps: audit?.totalOps,
          contactReputation: 'contactReputation' in mint ? mint.contactReputation : undefined,
          contactFollowers: 'contactFollowers' in mint ? mint.contactFollowers : undefined,
        },
      })}
      subtitle={extractDomain(mint.url)}
      titleTrailing={loading ? undefined : <TierBadge eventId={mint.url} />}
      selectable
      selected={selected}
      onToggle={() => onToggle(mint.url)}
      selectionVariant="checkbox"
      disabled={globalLoading}
      testID={loading ? `contact-row:mint-skeleton:${mint.url}` : `contact-row:mint:${mint.url}`}
    />
  );
}

export function MintAddScreen() {
  useLifecycleLogger('MintAddScreen');
  const surface = useThemeColor('surface');
  const { width: windowWidth } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(windowWidth);

  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const mintImport = useMintImport();
  const isAdding = mintImport.state?.running ?? false;
  usePreventRemove(isAdding, noop);

  // Receive-rail discovery CTAs deep-link here pre-filtered by the payment
  // method AND unit the rail needs (?method=bolt12|onchain&unit=sat). Matching
  // keys off nagg's per-mint NUT-04 (method, unit) pairs; the unit seeds the
  // currency tab so discovery opens on that unit and the method filter binds to
  // the (method, unit) pair (see `discoveryMethodMatches`).
  const { method: methodParam, unit: unitParam } = useLocalSearchParams<{
    method?: string;
    unit?: string;
  }>();
  const methodFilter =
    methodParam === 'bolt12' || methodParam === 'onchain' ? methodParam : undefined;
  const methodLabel = methodFilter === 'bolt12' ? 'BOLT 12' : 'Onchain';
  // Currency-tab values are uppercase unit codes ('SAT', 'USD', …) with 'ALL' as
  // the no-filter sentinel; the rail unit is lowercase ('sat').
  const initialCurrency = unitParam?.trim().toUpperCase() || 'ALL';
  const [selectedCurrency, setSelectedCurrency] = useState(initialCurrency);
  useEffect(() => {
    if (methodFilter) cashuLog.info('mint.add.method_filter', { method: methodFilter });
  }, [methodFilter]);

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
    if (q.includes('.') || q.toLowerCase().startsWith('http')) {
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
        ...mintUrlLogFields(validatedUrl),
        hasIcon: !!customMintInfo?.icon_url,
        name: customMintInfo?.name,
      });
    } else if (validationState.isValid === false) {
      cashuLog.debug('mint.add.url_validation.invalid', { ...mintUrlLogFields(validatedUrl) });
    }
  }, [validationState, validatedUrl, customMintInfo]);

  // Server-side mint search
  const {
    results: searchResults,
    loading: searchLoading,
    status: searchStatus,
    refresh: retrySearch,
    availableUnits,
    matchCountByUnit,
  } = useMintSearch(searchQuery, selectedCurrency, { method: methodFilter });

  const { mints: knownMints } = useMintManagement();

  // Subscribe to the unified metadata cache so that when `useMintProfiles`
  // finishes resolving an operator's Nostr profile, `adaptSearchResult` re-runs
  // and the row picks up `contactFollowers` / `contactReputation`.
  const mintProfileCache = useMintMetadataStore((s) => s.byMintUrl);

  // Adapt server results to display format, filter out already-known mints.
  // KEPT under React Compiler: the dep array deliberately includes
  // `mintProfileCache` (unused in the body) so the compute re-runs when the
  // metadata store updates — `adaptSearchResult` reads the store non-reactively
  // via getState(). The compiler would memoize on actual reads and drop that
  // subscription-driven recompute.
  // ast-grep-ignore: no-manual-memo-tsx
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
    // `mintProfileCache` is a deliberate trigger, not an input: the adapt step
    // reads it through a closure, so the list must rebuild as operator profiles
    // resolve even though the body never names the cache.
  }, [searchResults, knownMints, searchQuery, validationState, customMintInfo, mintProfileCache]);

  // Kick off Nostr profile fetches for any search result that has an operator
  // pubkey in NUT-06 contact info. Results land in `mintMetadataStore`
  // and the memo above re-runs once they arrive.
  const profileFetchInputs = displayMints.map((m) => ({
    url: m.url,
    mintInfo: 'mintInfo' in m ? m.mintInfo : undefined,
  }));
  useMintProfiles(profileFetchInputs);

  // Retain the deep-linked unit even after switching to another tab.
  const availableCurrencies = [
    'ALL',
    ...extractAvailableCurrencies([
      availableUnits,
      initialCurrency === 'ALL' ? [] : [initialCurrency],
    ]),
  ];

  const handleToggleMint = (mintUrl: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      const wasSelected = next.has(mintUrl);
      if (wasSelected) {
        next.delete(mintUrl);
      } else {
        next.add(mintUrl);
      }
      cashuLog.debug('mint.add.item.toggle', {
        ...mintUrlLogFields(normalizeMintUrlKey(mintUrl)),
        selected: !wasSelected,
        totalSelected: next.size,
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (selectedMints.size === 0) {
      staticPopup('no-mints-selected');
      return;
    }
    if (isAdding) return;
    await mintImport.start(selectedMints);
  };

  // Skeleton rows are LIST ITEMS rendered through the SAME List + ContactRow
  // path as real rows — identical chrome, no content shift on the swap, and no
  // second list mounted to crossfade. Only a first paint with nothing cached
  // shows them: a stale-cache revalidate keeps the rows it has (hunch rule ui/read-states).
  const isInitialLoading = searchLoading && displayMints.length === 0;

  const renderItem = ({ item }: { item: SearchableMint }) =>
    'isSkeleton' in item ? (
      <MintItem mint={item} selected={false} onToggle={noop} globalLoading loading />
    ) : (
      <MintItem
        mint={item}
        selected={selectedMints.has(item.url)}
        onToggle={handleToggleMint}
        globalLoading={isAdding}
      />
    );

  // Log list render state for performance analysis
  useEffect(() => {
    cashuLog.debug('mint.add.list.render', {
      isInitialLoading,
      searchLoading,
      itemCount: displayMints.length,
      isSearching,
      searchQuery: searchQuery.trim() ? searchQuery : undefined,
      selectedCurrency,
      selectedCount: selectedMints.size,
    });
  }, [
    isInitialLoading,
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
  const renderHeaderTitle = () =>
    isSearching ? (
      Platform.OS === 'ios' ? (
        <GlassSearchBar
          testID="mint-add-search-input"
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
        {methodFilter ? `Add ${methodLabel} Mints` : 'Add Mints'}
      </Text>
    );

  // ScreenHeaderAction + monicon glyphs (not IconSymbol/SF Symbols —
  // expo-symbols renders nothing on Android, which left this button invisible
  // there).
  const renderHeaderRight = () =>
    isSearching ? (
      <ScreenHeaderAction
        testID="mint-add-search-close"
        accessibilityLabel="Close search"
        icon="material-symbols:close-rounded"
        size={20}
        onPress={onCloseSearch}
      />
    ) : (
      <ScreenHeaderAction
        testID="mint-add-search-toggle"
        accessibilityLabel="Search mints"
        icon="material-symbols:search-rounded"
        size={20}
        onPress={onOpenSearch}
      />
    );

  const screenOptions = withGlassHeaderItems({
    headerTransparent: true as const,
    // Declares the page background (bgColor={surface} below) so the Android
    // sheet header's scrim fades from the page's color, not the darker
    // theme background. FlowSheetHeader reads this; iOS ignores it under a
    // transparent header.
    headerTitle: renderHeaderTitle,
    headerRight: renderHeaderRight,
  });

  // ── Sticky content & bottom ────────────────────────────────────────────

  const {
    setTotalHeaderHeight,
    handleScroll,
    currencyTabs,
    headerSpacer: listHeader,
  } = useStickyCurrencyTabs({
    currencies: availableCurrencies,
    selectedCurrency,
    onCurrencyChange: setSelectedCurrency,
  });

  const bottomButtons = (
    <BottomButtons>
      <ButtonHandler
        buttons={[
          {
            testID: 'mint-add-confirm',
            text: isAdding ? 'Adding...' : `Add (${selectedMints.size})`,
            variant: 'primary',
            onPress: handleSave,
            disabled: selectedMints.size === 0 || isAdding,
          },
          {
            testID: 'mint-add-cancel',
            text: 'Cancel',
            variant: 'secondary',
            onPress: async () => router.back(),
          },
        ]}
      />
    </BottomButtons>
  );

  const hasUnitMatches = Object.values(matchCountByUnit).some((count) => count > 0);
  const unitLabel = accountUnitLabel(selectedCurrency);
  const showBtcMints =
    methodFilter &&
    selectedCurrency !== 'ALL' &&
    selectedCurrency !== 'SAT' &&
    matchCountByUnit.SAT > 0;

  const discoveryFailed = searchStatus === 'error' && searchResults.length === 0;
  const emptyTitle = searchQuery.trim()
    ? 'No mints found matching your search'
    : methodFilter
      ? selectedCurrency !== 'ALL' && hasUnitMatches
        ? `No known mints support ${methodLabel} for ${unitLabel} yet`
        : `No known mints support ${methodLabel} yet`
      : selectedCurrency === 'ALL'
        ? 'No mints available'
        : `No mints available for ${accountUnitLabel(selectedCurrency)}`;
  const emptyComponent = discoveryFailed ? (
    <EmptyState
      icon="mdi:cloud-off-outline"
      title="Couldn't load mints right now"
      action={
        <Button
          testID="mint-add-retry"
          text="Try again"
          variant="secondary"
          onPress={retrySearch}
        />
      }
    />
  ) : (
    <EmptyState
      icon={searchQuery.trim() ? 'mdi:magnify' : 'mingcute:bank-fill'}
      title={emptyTitle}
      action={
        showBtcMints ? (
          <Button
            testID="mint-add-empty-switch-unit"
            text={`Show BTC ${methodLabel} mints (${matchCountByUnit.SAT})`}
            variant="secondary"
            onPress={() => setSelectedCurrency('SAT')}
          />
        ) : undefined
      }
    />
  );

  const renderResultList = (data: SearchableMint[]) => (
    <List
      screen
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      extraData={selectedMints}
      drawDistance={300}
      // FlashList v2 enables maintainVisibleContentPosition by default (anchor
      // sits before the ListHeaderComponent), which mis-anchors a short list
      // with a tall spacer header and snaps on first scroll (flash-list#2050).
      // Opt out so the JS spacer is the sole inset authority.
      maintainVisibleContentPosition={{ disabled: true }}
      contentInsetAdjustmentBehavior="never"
      style={{ flex: 1, height: 0 }}
      ListHeaderComponent={listHeader}
      // Skeleton data is non-empty, so the empty state can't flash mid-load.
      ListEmptyComponent={isInitialLoading ? undefined : emptyComponent}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    />
  );

  if (mintImport.state) {
    const { running, items } = mintImport.state;
    const complete = items.filter((item) => item.stage === 'complete').length;
    const added = items.filter(
      (item) => item.stage === 'complete' || item.stage === 'restore-failed'
    ).length;
    const allComplete = complete === items.length;
    const currentItem = items.find((item) => item.stage === 'adding' || item.stage === 'restoring');
    const recoveryIncomplete = items.some((item) => item.stage === 'restore-failed');
    const subtitle = running
      ? items.length === 1
        ? extractDomain(items[0].url)
        : `${Math.max(1, items.findIndex((item) => item === currentItem) + 1)} of ${items.length}`
      : allComplete
        ? items.length === 1
          ? extractDomain(items[0].url)
          : `${items.length} mints added`
        : recoveryIncomplete
          ? 'Recovery incomplete. Retry in Settings.'
          : added > 0
            ? `${added} of ${items.length} mints added`
            : 'Please try again.';
    return (
      <Screen
        name="MintAddScreen"
        bgColor={surface}
        deferContent={false}
        footer={
          <BottomButtons>
            <ButtonHandler
              buttons={[
                {
                  testID: 'mint-import-done',
                  text: added > 0 ? 'Done' : 'Back to mints',
                  variant: 'primary',
                  disabled: running,
                  onPress: async () => {
                    if (added > 0) router.back();
                    else mintImport.dismiss();
                  },
                },
              ]}
            />
          </BottomButtons>
        }>
        <Stack.Screen
          options={withGlassHeaderItems({
            title: 'Add Mints',
            headerTitle: () => (
              <Text size={17} bold className="text-foreground">
                Add Mints
              </Text>
            ),
            headerRight: () => null,
            gestureEnabled: !running,
            headerBackButtonMenuEnabled: false,
          })}
        />
        <View
          className="items-center px-6 py-16"
          accessibilityLiveRegion="polite"
          testID="mint-import-progress">
          <LoadingIndicator
            size={64}
            phase={running ? 'loading' : 'done'}
            result={allComplete ? 'success' : added > 0 ? 'warning' : 'error'}
          />
          <Spacer size={24} />
          <Text size={24} bold className="text-foreground text-center">
            {running
              ? items.length === 1
                ? 'Adding mint'
                : 'Adding mints'
              : added === items.length
                ? items.length === 1
                  ? 'Mint added'
                  : 'Mints added'
                : added > 0
                  ? 'Some mints added'
                  : 'Couldn’t add mint'}
          </Text>
          <Spacer size={8} />
          <Text className="text-muted min-h-10 text-center">{subtitle}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      name="MintAddScreen"
      headerGradient
      headerAppearance="gradient-tabs"
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
      {renderResultList(isInitialLoading ? SKELETON_MINTS : displayMints)}
    </Screen>
  );
}
