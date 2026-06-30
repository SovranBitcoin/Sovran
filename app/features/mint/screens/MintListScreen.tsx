/**
 * @fileoverview Shared Mint List screen component
 *
 * Pure display component — receives a pre-built MintListItem[] and renders it.
 * All data fetching (balances, KYM scores, audit data, availability) is done
 * before navigation via machine operations in Colada.tsx.
 *
 * The only local state is the selected currency tab.
 */

import React, { memo, useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { List } from '@/shared/ui/composed/List';

import type { MintListItem } from '@sovranbitcoin/colada';
import type { MintRow } from '@/features/mint/hooks/useMintRowsWithCache';

import Icon from 'assets/icons';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import opacity from 'hex-color-opacity';
import { ContactRow, mintIdentity } from '@/shared/ui/composed/ContactRow';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import {
  MintCurrencyTabs,
  MINT_CURRENCY_TABS_HEIGHT,
} from '@/features/mint/components/MintCurrencyTabs';
import { useShiftLogger } from '@/shared/lib/contentShiftLog';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { cashuLog, useLifecycleLogger } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

// Inspect-button shape mirrors QRButton (rounded-square with continuous border
// curve, borderRadius ≈ size × 0.18), but in a neutral surface color so it
// reads as secondary action rather than the wallet's primary CTA. Sized to
// match the avatar height so the [pfp][name/balance][button] row is balanced.
const INSPECT_BUTTON_SIZE = 44;
const INSPECT_BUTTON_RADIUS = Math.round(INSPECT_BUTTON_SIZE * 0.18);

const CURRENCY_TABS_HEIGHT = MINT_CURRENCY_TABS_HEIGHT;

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

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

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

// Reuses the same primitive as the transactions "View all" button: a
// continuous-curve rounded rectangle with a `muted`-tinted border and a
// `BlurCardFrame` background. Corner glows are suppressed (`glow={false}`)
// because BlurCardFrame's gradients are calibrated to a 70 px box with a
// 40 px diagonal fade — on a 44 px container the two opposite glows overlap
// across the whole face and the 0.6-alpha corner pixel reads as a hotspot.
// Without glows the button keeps the blur surface + soft border treatment
// that ties it to the View-all family while still mirroring QRButton's shape.
function MintInspectButton({ onPress }: { onPress: () => void }) {
  const [muted, foreground] = useThemeColor(['muted', 'foreground'] as const);
  const borderColor = opacity(muted, 0.3);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Open mint page"
      style={{
        width: INSPECT_BUTTON_SIZE,
        height: INSPECT_BUTTON_SIZE,
      }}>
      <SquircleView
        style={{
          flex: 1,
          borderRadius: INSPECT_BUTTON_RADIUS,
          borderCurve: 'continuous',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor,
        }}>
        <BlurCardFrame accentColor={muted} glow={false}>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: zIndex.raised,
            }}>
            <Icon name="bx:dots-vertical-rounded" size={20} color={foreground} />
          </View>
        </BlurCardFrame>
      </SquircleView>
    </Pressable>
  );
}

export const MintListScreen = memo(function MintListScreen({
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

  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const scrollY = useSharedValue(0);
  const [totalHeaderHeight, setTotalHeaderHeight] = useState(0);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL');

  // Content-shift telemetry: with the currency-tab strip pinned to a fixed
  // height, the reserved header height should settle on the first measure and
  // never produce a follow-up delta. A non-null delta here = a shift regressed.
  const shift = useShiftLogger('MintListScreen');
  useEffect(() => {
    shift.report('mint.list.header.shift', 'totalHeaderHeight', totalHeaderHeight);
  }, [totalHeaderHeight, shift]);

  const prevRenderKey = useRef('');
  const renderKey = `${items.length}:${isExecuting}`;
  useEffect(() => {
    if (renderKey !== prevRenderKey.current) {
      prevRenderKey.current = renderKey;
      cashuLog.debug('mint.list.render', { itemCount: items.length, isExecuting });
    }
  });

  // Derive available currencies from items (no mint metadata needed — unit is in the item)
  const availableCurrencies = useMemo(() => {
    const units = [...new Set(items.map((item) => item.unit.toUpperCase()))];
    return ['ALL', ...units];
  }, [items]);

  // Filter by selected currency tab
  const filteredItems = useMemo(() => {
    if (selectedCurrency === 'ALL') return items;
    return items.filter((item) => item.unit.toUpperCase() === selectedCurrency);
  }, [items, selectedCurrency]);

  const handleCurrencyChange = useCallback((currency: string) => {
    cashuLog.info('mint.list.currency.change', { currency });
    setSelectedCurrency(currency);
  }, []);

  const handleMintPress = useCallback(
    (item: MintListItem) => {
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
    },
    [isExecuting, onMintSelect]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
    },
    [scrollY]
  );

  const currencyTabs = useMemo(
    () => (
      <MintCurrencyTabs
        currencies={availableCurrencies}
        selectedCurrency={selectedCurrency}
        onCurrencyChange={handleCurrencyChange}
        scrollY={scrollY}
      />
    ),
    [availableCurrencies, selectedCurrency, handleCurrencyChange, scrollY]
  );

  // Reserves the full header height (nav + sticky tabs). The wrapper now derives
  // that from a frame-0-stable value on iOS, so this spacer no longer reflows.
  const listHeader = useMemo(
    () => <View style={{ height: totalHeaderHeight }} />,
    [totalHeaderHeight]
  );

  const emptyComponent = useMemo(
    () => (
      <Text style={{ color: opacity(foreground, 0.66), textAlign: 'center', marginTop: 20 }}>
        {selectedCurrency === 'ALL'
          ? 'No mints available'
          : `No mints available for ${selectedCurrency === 'SAT' ? 'BTC' : selectedCurrency}`}
      </Text>
    ),
    [selectedCurrency, foreground]
  );
  const keyExtractor = useCallback((item: MintListItem) => item.mintUrl, []);

  const bottomButtons = useMemo(
    () => (
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
    ),
    [closeButtonLabel, onClose]
  );

  const renderItem = useCallback(
    ({ item }: { item: MintListItem }) => {
      const inspectable = showDetailsButton && !!onInspectMint;
      const trailing = inspectable ? (
        <MintInspectButton onPress={() => onInspectMint!(item.mintUrl)} />
      ) : null;
      return (
        <ContactRow
          identity={mintIdentity(item)}
          disabled={isExecuting || item.status !== 'available'}
          disabledReason={getMintDisabledReasonLabel(item.reason) ?? undefined}
          trailing={trailing}
          trailingVariant={inspectable ? undefined : 'none'}
          accentPosition="below"
          // Stats roll in when cached values are replaced by fresh ones; the
          // accent is keyed by mintUrl inside ContactRow against FlashList recycle.
          animate
          onPress={() => handleMintPress(item)}
          testID={`contact-row:mint:${item.mintUrl}`}
        />
      );
    },
    [isExecuting, showDetailsButton, handleMintPress, onInspectMint]
  );

  // Skeleton row through the SAME ContactRow path (pulsing avatar + title /
  // subtitle bars), so the crossfade to real rows shifts nothing.
  const renderSkeletonItem = useCallback(
    ({ item }: { item: MintListItem }) => (
      <ContactRow
        loading
        identity={mintIdentity(item)}
        accentPosition="below"
        trailingVariant="none"
        testID={`contact-row:mint-skeleton:${item.mintUrl}`}
      />
    ),
    []
  );

  // Per-row branch: a cold row (no cache, not yet enriched) renders the skeleton
  // ContactRow; a cached/live row renders the real one. This is what guarantees
  // we never paint a bare url + bank-icon fallback — a row is either a skeleton
  // or carries a real cached/live name + icon.
  const renderRow = useCallback(
    ({ item }: { item: MintRow }) =>
      item.metaState === 'cold' ? renderSkeletonItem({ item }) : renderItem({ item }),
    [renderItem, renderSkeletonItem]
  );

  // The cohesive full-list shimmer wave shows only when EVERY row is cold (cold
  // first-ever open). A mixed/cached list renders real rows immediately and lets
  // the per-row branch skeleton just the cold ones.
  const showSkeleton = loading && filteredItems.length > 0;

  const renderList = useCallback(
    (data: MintRow[], skeleton: boolean) => (
      <List
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
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
        ListHeaderComponent={listHeader}
        // Skeleton data is non-empty, so the empty text can't flash mid-load.
        ListEmptyComponent={skeleton ? undefined : emptyComponent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
    ),
    [
      renderRow,
      renderSkeletonItem,
      keyExtractor,
      isExecuting,
      listHeader,
      emptyComponent,
      handleScroll,
    ]
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
});
