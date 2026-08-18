import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  Platform,
  TextInput,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
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
import type { MintSearchResult } from '@/shared/lib/apiClient';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
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
import { TierBadge } from '@/shared/ui/composed/TierBadge';
import { List } from '@/shared/ui/composed/List';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Screen } from '@/shared/ui/composed/Screen';
import { LoadingIndicator } from '@/shared/blocks/status';
import {
  MintCurrencyTabs,
  MINT_CURRENCY_TABS_HEIGHT,
} from '@/features/mint/components/MintCurrencyTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import opacity from 'hex-color-opacity';
import { log, cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';
import type { GetInfoResponse } from '@cashu/cashu-ts';

// Height constant for currency tabs (same as MintListScreen)
const CURRENCY_TABS_HEIGHT = MINT_CURRENCY_TABS_HEIGHT;

// MintStatCell removed — stats now rendered inline

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

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

/** Quiet period the discovered list must hold before the skeleton hands over.
 *  Operator profiles resolve one at a time and each arrival re-renders a row,
 *  so swapping in real content on the first result makes the list shift under
 *  the reader. */
const RESULTS_SETTLE_QUIET_MS = 500;
/** Ceiling from mount. A slow trickle of profile resolutions must never hold
 *  the skeleton open, so the quiet period stops being chased after this. */
const RESULTS_SETTLE_CEILING_MS = 3000;

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
  /** Server-provided audit state for sorting badge color */
  auditState?: string;
  /** Server-provided total operations for stats display */
  serverStats?: { n_mints: number; n_melts: number; n_errors: number };
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

// Pre-baked mint row — deferred to the shared `ContactRow` so search results
// here visually match the mint list, contacts tab, and split-bill picker.
//
// `loading` renders the row in skeleton mode through the SAME `ContactRow`, so
// the loading placeholder and the real row share every layout box (avatar,
// title, subtitle, stats accent, checkbox) and can't drift in height. The mint
// fields are read defensively because skeleton items carry only a synthetic
// `url`; their values are never shown (loading swaps in placeholder bars).
const MintItem = memo(function MintItem({
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
  const displayName = useMemo(() => getMintDisplayName(mint.url, mintInfo), [mint.url, mintInfo]);

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
    // n_errors is a SEPARATE count of failed operations, not a subset of
    // n_mints/n_melts (which count successes). So the success rate is
    // successes / (successes + errors) — bounded 0..1. The old
    // `1 - errors/successes` went deeply negative for error-heavy mints
    // (e.g. coinos: 39 successes vs 235 errors → -503%).
    const successOps = n_mints + n_melts;
    const totalOps = successOps + n_errors;
    if (totalOps <= 0) return { auditScore: undefined, auditTotalOps: undefined };
    const successRate = Math.max(0, Math.min(1, successOps / totalOps)); // 0..1
    return { auditScore: successRate * 5, auditTotalOps: totalOps };
  }, [mint]);

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
          auditScore,
          auditState: 'auditState' in mint ? mint.auditState : undefined,
          auditTotalOps,
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
  const [selectedCurrency, setSelectedCurrency] = useState(
    unitParam ? unitParam.trim().toUpperCase() : 'ALL'
  );
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
  const { results: searchResults, loading: searchLoading } = useMintSearch(
    searchQuery,
    selectedCurrency,
    { method: methodFilter }
  );

  const { mints: knownMints } = useMintManagement();

  // Subscribe to the unified metadata cache so that when `useMintProfiles`
  // finishes resolving an operator's Nostr profile, `adaptSearchResult` re-runs
  // and the row picks up `contactFollowers` / `contactReputation`.
  const mintProfileCache = useMintMetadataStore((s) => s.byMintUrl);

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

  // Hold the skeleton until the discovered list stops changing, so rows do not
  // pop in one-by-one as operator profiles resolve. One-way: once settled the
  // skeleton never returns over content already shown.
  const [resultsSettled, setResultsSettled] = useState(false);
  useEffect(() => {
    if (resultsSettled) return;
    const timer = setTimeout(() => setResultsSettled(true), RESULTS_SETTLE_QUIET_MS);
    return () => clearTimeout(timer);
  }, [displayMints, resultsSettled]);
  useEffect(() => {
    const ceiling = setTimeout(() => setResultsSettled(true), RESULTS_SETTLE_CEILING_MS);
    return () => clearTimeout(ceiling);
  }, []);

  // Kick off Nostr profile fetches for any search result that has an operator
  // pubkey in NUT-06 contact info. Results land in `mintMetadataStore`
  // and the memo above re-runs once they arrive.
  const profileFetchInputs = useMemo(
    () =>
      displayMints.map((m) => ({ url: m.url, mintInfo: 'mintInfo' in m ? m.mintInfo : undefined })),
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
        ...mintUrlLogFields(normalizeMintUrlKey(mintUrl)),
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
        log.debug('mint.add.item.adding', {
          index: i + 1,
          total: mintUrlsToAdd.length,
          ...mintUrlLogFields(mintUrl),
        });
        try {
          await manager.mint.addMint(mintUrl, { trusted: true });
          const addDuration = Math.round(performance.now() - itemT0);
          log.info('mint.add.item.added', {
            ...mintUrlLogFields(mintUrl),
            duration_ms: addDuration,
          });
          results.push(mintUrl);

          // Restore proofs for the newly added mint
          try {
            const restoreT0 = performance.now();
            await manager.wallet.restore(mintUrl);
            log.info('mint.add.restore.success', {
              ...mintUrlLogFields(mintUrl),
              duration_ms: Math.round(performance.now() - restoreT0),
            });
          } catch (restoreErr) {
            log.warn('mint.add.restore.failed', {
              ...mintUrlLogFields(mintUrl),
              error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
            });
          }

          if (i < mintUrlsToAdd.length - 1) {
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch (err) {
          log.error('mint.add.item.failed', {
            ...mintUrlLogFields(mintUrl),
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

  const keyExtractor = useCallback((item: SearchableMint) => item.url, []);

  // Feed the result List skeleton placeholders during the first search so the
  // loading rows render through the SAME List + ContactRow path as real rows —
  // identical container chrome, no content shift on the data swap.
  const isInitialLoading = searchLoading || !resultsSettled;
  const getItemType = useCallback(
    (item: SearchableMint) => ('isSkeleton' in item ? 'skeleton' : 'mint'),
    []
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchableMint }) =>
      'isSkeleton' in item ? (
        <MintItem mint={item} selected={false} onToggle={noop} globalLoading loading />
      ) : (
        <MintItem
          mint={item}
          selected={selectedMints.has(item.url)}
          onToggle={handleToggleMint}
          globalLoading={isAdding}
        />
      ),
    [handleToggleMint, isAdding, selectedMints]
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
  const renderHeaderTitle = useCallback(
    () =>
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
      ),
    [
      isSearching,
      searchBarWidth,
      onSearchChange,
      clearKey,
      searchQuery,
      validationState,
      methodFilter,
      methodLabel,
    ]
  );

  // ScreenHeaderAction + monicon glyphs (not IconSymbol/SF Symbols —
  // expo-symbols renders nothing on Android, which left this button invisible
  // there).
  const renderHeaderRight = useCallback(
    () =>
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
      ),
    [isSearching, onCloseSearch, onOpenSearch, foreground]
  );

  const screenOptions = useMemo(
    () =>
      withGlassHeaderItems({
        headerTransparent: true as const,
        // Declares the page background (bgColor={surface} below) so the Android
        // sheet header's scrim fades from the page's color, not the darker
        // theme background. FlowSheetHeader reads this; iOS ignores it under a
        // transparent header.
        headerStyle: { backgroundColor: surface },
        headerTitle: renderHeaderTitle,
        headerRight: renderHeaderRight,
      }),
    [renderHeaderTitle, renderHeaderRight, surface]
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
    ),
    [isAdding, selectedMints.size, handleSave]
  );

  // Reserves the full header height; the wrapper derives it from a frame-0-stable
  // value on iOS, so this spacer no longer reflows on a late header settle.
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
            : methodFilter
              ? `No known mints support ${methodLabel} yet`
              : selectedCurrency === 'ALL'
                ? 'No mints available'
                : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
        </Text>
      </View>
    ),
    [searchQuery, selectedCurrency, methodFilter, methodLabel]
  );

  // One List renderer for both crossfade branches: the skeleton branch and the
  // real branch render the SAME List + ContactRow path, so the swap shifts
  // nothing. Two List instances coexist only for the ~220ms fade.
  const renderResultList = useCallback(
    (data: SearchableMint[]) => (
      <List
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
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={listHeader}
        // Skeleton data is non-empty, so the empty state can't flash mid-load.
        ListEmptyComponent={isInitialLoading ? undefined : emptyComponent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
    ),
    [
      renderItem,
      keyExtractor,
      getItemType,
      selectedMints,
      listHeader,
      isInitialLoading,
      emptyComponent,
      handleScroll,
    ]
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
      <SkeletonContentCrossfade
        loading={isInitialLoading}
        style={{ flex: 1 }}
        visualKey="mint-add-results"
        visualSurface="mint-add"
        renderSkeleton={() => renderResultList(SKELETON_MINTS)}
        renderContent={() => renderResultList(displayMints)}
      />
    </Screen>
  );
}
