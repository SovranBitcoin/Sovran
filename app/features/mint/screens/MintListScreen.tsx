import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { getMockMintBalance } from '@/shared/stores/runtime/mockDataStore';
/**
 * @fileoverview Shared Mint List screen component
 *
 * Pure display component — receives a pre-built MintListItem[] and renders it.
 * All data fetching (balances, KYM scores, audit data, availability) is done
 * before navigation via machine operations in Colada.tsx.
 *
 * The only local state is the selected currency tab.
 */

import { useEffect, useRef, useState } from 'react';

import { List } from '@/shared/ui/composed/List';

import type { MintListItem } from 'wallet';
import type { MintRow } from '@/features/mint/hooks/useMintRowsWithCache';

import { Text } from '@/shared/ui/primitives/Text';
import { withAlpha } from '@/shared/lib/color';
import { ContactRow, mintIdentity } from '@/shared/ui/composed/ContactRow';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { MINT_CURRENCY_TABS_HEIGHT } from '@/features/mint/components/MintCurrencyTabs';
import { useStickyCurrencyTabs } from '@/features/mint/hooks/useStickyCurrencyTabs';
import { useShiftLogger } from '@/shared/lib/contentShiftLog';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { cashuLog, useLifecycleLogger, mintUrlLogFields } from '@/shared/lib/logger';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';

const CURRENCY_TABS_HEIGHT = MINT_CURRENCY_TABS_HEIGHT;

// The currency badge ('units') is intentionally omitted: this screen already
// has currency filter tabs, so a per-row BTC·USD pill is redundant noise.
const MINT_ROW_STATS = ['score', 'audit', 'reputation', 'followers', 'offline'] as const;

// Placeholder rows shown while the selector's items are still resolving. Stable
// synthetic urls keep keys deterministic; their values are never read (the rows
// render in ContactRow's `loading` mode, which swaps in pulsing skeleton bars).
const SKELETON_ITEM_COUNT = 5;
const SKELETON_ITEMS: MintRow[] = Array.from({ length: SKELETON_ITEM_COUNT }, (_, i) => ({
  mintUrl: `mint-skeleton-${i}`,
  displayName: '',
  balance: 0,
  unit: 'sat',
  status: 'available',
  reason: null,
  isPreferred: false,
  metaState: 'cold',
}));

interface MintListScreenProps {
  /** Pre-built mint rows (base colada rows overlaid with cached metadata, each
   *  tagged with a `metaState`). Already sorted and availability-annotated. */
  items: MintRow[];
  /** True only when EVERY row is cold (no cache, not yet enriched) — drives the
   *  cohesive full-list shimmer wave. Mixed/cached lists render per-row instead. */
  loading?: boolean;
  /** When true, all rows show a global loading state (a handler is executing). */
  isExecuting?: boolean;
  /** Whether to show the details/inspect button on each mint (default: true) */
  showDetailsButton?: boolean;
  /** Label for close/cancel button (default: "Close") */
  closeButtonLabel?: string;
  /** Called when a selectable mint is tapped */
  onMintSelect: (item: MintListItem) => void;
  /** Called when inspect/details button is pressed on a mint */
  onInspectMint?: (mintUrl: string) => void;
  /** Called when close/cancel button is pressed */
  onClose: () => void;
}

function getMintDisabledReasonLabel(reason: MintListItem['reason']): string | null {
  return reason?.message ?? null;
}

function extractAvailableCurrencies(items: MintRow[]): string[] {
  const units = new Set<string>();
  for (const item of items) {
    for (const unit of item.supportedUnits ?? []) {
      units.add(unit.toUpperCase());
    }
  }
  // Sat first, then the rest alphabetically — stable tab order.
  const ordered = [...units].sort((a, b) =>
    a === 'SAT' ? -1 : b === 'SAT' ? 1 : a.localeCompare(b)
  );
  return ['ALL', ...ordered];
}

const keyExtractor = (item: MintListItem) => item.mintUrl;

// Same liquid-glass circle as the send/receive modal action rows (icon-only,
// `tabler:dots` + `ellipsis` mirrors CircleActionRow's "More" button). The
// liquid variant renders scroll-safe GlassView glass on supported devices and
// the shared flat chip elsewhere.
function MintInspectButton({ mintUrl, onPress }: { mintUrl: string; onPress: () => void }) {
  return (
    <CircleActionButton
      icon="tabler:dots"
      systemIcon="ellipsis"
      onPress={onPress}
      // Per-row id: every mint row renders this button, so the shared AX label
      // alone is ambiguous for device tests.
      testID={`mint-inspect:${mintUrl}`}
      accessibilityLabel="Open mint page"
    />
  );
}

export function MintListScreen({
  items,
  loading = false,
  isExecuting = false,
  showDetailsButton = true,
  closeButtonLabel = 'Close',
  onMintSelect,
  onInspectMint,
  onClose,
}: MintListScreenProps) {
  useLifecycleLogger('MintListScreen', cashuLog);
  const mockMode = useSettingsStore((state) => state.mockMode);

  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL');

  const prevRenderKey = useRef('');
  const renderKey = `${items.length}:${isExecuting}`;
  useEffect(() => {
    if (renderKey !== prevRenderKey.current) {
      prevRenderKey.current = renderKey;
      cashuLog.debug('mint.list.render', { itemCount: items.length, isExecuting });
    }
  });

  // Tabs list every unit some mint can ACTUALLY issue (keyset-backed
  // `supportedUnits` from colada). `item.unit` is only the flow's
  // denomination — every row carries the same value, which is why filtering
  // on it used to be a visible no-op. Fallback rows without supportedUnits
  // (pre-enrichment) contribute nothing here and pass every filter below.
  const availableCurrencies = extractAvailableCurrencies(items);

  // Filter to mints that can issue the selected unit. Unknown supportedUnits
  // (fallback rows) always pass — never hide a mint on missing data.
  const filteredItems =
    selectedCurrency === 'ALL'
      ? items
      : items.filter(
          (item) =>
            !item.supportedUnits ||
            item.supportedUnits.some((unit) => unit.toUpperCase() === selectedCurrency)
        );

  const handleCurrencyChange = (currency: string) => {
    cashuLog.info('mint.list.currency.change', { currency });
    setSelectedCurrency(currency);
  };

  const {
    totalHeaderHeight,
    setTotalHeaderHeight,
    handleScroll,
    currencyTabs,
    headerSpacer: listHeader,
  } = useStickyCurrencyTabs({
    currencies: availableCurrencies,
    selectedCurrency,
    onCurrencyChange: handleCurrencyChange,
  });

  // Content-shift telemetry: with the currency-tab strip pinned to a fixed
  // height, the reserved header height should settle on the first measure and
  // never produce a follow-up delta. A non-null delta here = a shift regressed.
  const shift = useShiftLogger('MintListScreen');
  useEffect(() => {
    shift.report('mint.list.header.shift', 'totalHeaderHeight', totalHeaderHeight);
  }, [totalHeaderHeight, shift]);

  // Enrichment can shrink the tab set (e.g. an advertised-but-keyless unit
  // disappears); never leave the filter pointing at a tab that no longer
  // exists.
  useEffect(() => {
    if (selectedCurrency !== 'ALL' && !availableCurrencies.includes(selectedCurrency)) {
      cashuLog.info('mint.list.currency.reset', { from: selectedCurrency });
      setSelectedCurrency('ALL');
    }
  }, [availableCurrencies, selectedCurrency]);

  const handleMintPress = (item: MintListItem) => {
    if (isExecuting || item.status !== 'available') {
      cashuLog.debug('mint.list.select.blocked', {
        ...mintUrlLogFields(item.mintUrl),
        isExecuting,
        status: item.status,
      });
      return;
    }
    cashuLog.info('mint.list.select', { ...mintUrlLogFields(item.mintUrl), unit: item.unit });
    onMintSelect(item);
  };

  const emptyComponent = (
    <Text style={{ color: withAlpha(foreground, 0.66), textAlign: 'center', marginTop: 20 }}>
      {selectedCurrency === 'ALL'
        ? 'No mints available'
        : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
    </Text>
  );

  const bottomButtons = (
    <BottomButtons>
      <ButtonHandler
        buttons={[
          {
            text: closeButtonLabel,
            variant: 'secondary' as const,
            onPress: async () => onClose(),
          },
        ]}
      />
    </BottomButtons>
  );

  const renderItem = ({ item }: { item: MintListItem }) => {
    const inspectable = showDetailsButton && !!onInspectMint;
    const trailing = inspectable ? (
      <MintInspectButton mintUrl={item.mintUrl} onPress={() => onInspectMint!(item.mintUrl)} />
    ) : null;
    return (
      <ContactRow
        identity={mintIdentity(
          mockMode ? { ...item, balance: getMockMintBalance(item.mintUrl, item.unit) } : item
        )}
        stats={MINT_ROW_STATS}
        disabled={isExecuting || item.status !== 'available'}
        disabledReason={getMintDisabledReasonLabel(item.reason) ?? undefined}
        trailing={trailing}
        trailingInteractive={inspectable}
        trailingVariant={inspectable ? undefined : 'none'}
        accentPosition="below"
        // Stats roll in when cached values are replaced by fresh ones; the
        // accent is keyed by mintUrl inside ContactRow against FlashList recycle.
        animate
        onPress={() => handleMintPress(item)}
        testID={`contact-row:mint:${item.mintUrl}`}
      />
    );
  };

  // Skeleton row through the SAME ContactRow path (pulsing avatar + title /
  // subtitle bars), so the crossfade to real rows shifts nothing.
  const renderSkeletonItem = ({ item }: { item: MintListItem }) => (
    <ContactRow
      loading
      identity={mintIdentity(item)}
      accentPosition="below"
      trailingVariant="none"
      testID={`contact-row:mint-skeleton:${item.mintUrl}`}
    />
  );

  // Per-row branch: a cold row (no cache, not yet enriched) renders the skeleton
  // ContactRow; a cached/live row renders the real one. This is what guarantees
  // we never paint a bare url + bank-icon fallback — a row is either a skeleton
  // or carries a real cached/live name + icon.
  const renderRow = ({ item }: { item: MintRow }) =>
    item.metaState === 'cold' ? renderSkeletonItem({ item }) : renderItem({ item });

  // The cohesive full-list shimmer wave shows only when EVERY row is cold (cold
  // first-ever open). A mixed/cached list renders real rows immediately and lets
  // the per-row branch skeleton just the cold ones.
  const showSkeleton = loading && filteredItems.length > 0;

  const renderList = (data: MintRow[], skeleton: boolean) => (
    <List
      screen
      data={data}
      renderItem={skeleton ? renderSkeletonItem : renderRow}
      keyExtractor={keyExtractor}
      extraData={isExecuting}
      drawDistance={300}
      // FlashList v2 enables maintainVisibleContentPosition by default and
      // inserts its scroll anchor BEFORE the ListHeaderComponent, so with a
      // tall spacer header and a short (non-screen-filling) list it mis-anchors
      // the initial offset and snaps to the correct position on first scroll
      // (Shopify/flash-list#2050). This list is a plain top-anchored list, so
      // opt out. The JS spacer (header + max sticky-tab band) is then the sole
      // inset authority; `never` keeps iOS from re-adjusting it natively.
      maintainVisibleContentPosition={{ disabled: true }}
      contentInsetAdjustmentBehavior="never"
      style={{ flex: 1, height: 0 }}
      contentContainerClassName="pt-3"
      ListHeaderComponent={listHeader}
      // Skeleton data is non-empty, so the empty text can't flash mid-load.
      ListEmptyComponent={skeleton ? undefined : emptyComponent}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    />
  );

  return (
    <Screen
      name="MintListScreen"
      headerGradient
      stickyContent={currencyTabs}
      stickyContentHeight={CURRENCY_TABS_HEIGHT}
      scroll="custom"
      onHeaderHeightChange={setTotalHeaderHeight}
      footer={bottomButtons}
      bgColor={surface}>
      {/* iOS modal AX hides the root probe; mirror toast evidence in-sheet. */}
      <E2EToastProbe />
      <SkeletonContentCrossfade
        loading={showSkeleton}
        style={{ flex: 1 }}
        visualKey="mint-selector-list"
        visualSurface="mint-selector"
        renderSkeleton={() => renderList(SKELETON_ITEMS, true)}
        renderContent={() => renderList(filteredItems, false)}
      />
    </Screen>
  );
}
