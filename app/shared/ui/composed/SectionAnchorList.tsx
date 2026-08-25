/**
 * @fileoverview Section-anchored virtualized list.
 *
 * A generic section list where tapping an anchor pill in the horizontal
 * bar above the content scrolls to that section, and the active anchor
 * highlights as the user scrolls. The top chrome (anchor bar + optional
 * `aboveAnchors` block) sits transparently over the scroll viewport —
 * rows scrolling past fade out via a `ScrollEdgeFade` before passing
 * "behind" the chrome.
 *
 * For a sticky bottom region (Generate/Import buttons, a Next CTA, etc.)
 * compose `<BottomButtons>` as a *sibling* — same shape that screens
 * like Receive use (`<Screen footer={<BottomButtons>...}>`). Pass the
 * measured footer height back via `contentBottomInset` so the scroll
 * content clears it.
 *
 * Internals:
 *   - The body uses `@shopify/flash-list` (FlashList v2) under the hood for
 *     virtualization with item recycling. FlashList recycles cells and
 *     measures synchronously, so this handles 400+ equal-cell grids
 *     (emoji picker) at 60fps even on older devices with no size hints.
 *   - Sections are flattened into a single typed data array of
 *     `{kind:'header'|'row', sectionId, ...}` rows. For grids, callers
 *     pass `rowChunkSize > 1` and `renderRow` to lay N items per row;
 *     the chunking happens inside this component.
 *   - Active-anchor tracking uses `onViewableItemsChanged` (smallest
 *     visible index wins) with a ~400ms suppression window after a
 *     programmatic `scrollToIndex` to avoid feedback loops.
 *   - `overrideContent` lets callers swap the body wholesale (e.g.
 *     search-results mode). When non-null, the FlashList unmounts and
 *     the anchor bar hides — caller is responsible for any inner
 *     virtualization in this branch (typically another list).
 *   - `ScrollComponent` injection lets hosts pass
 *     `BottomSheetScrollView` so gorhom's pan gestures + keyboard
 *     handling stay coherent inside a sheet. FlashList wires it via
 *     its `renderScrollComponent` prop.
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  LayoutChangeEvent,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
  type ViewToken,
} from '@shopify/flash-list';
import { withAlpha } from '@/shared/lib/color';

import { ScrollEdgeFade } from './ScrollEdgeFade';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, useRenderLogger } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

const sectionListLog = log.child({ module: 'sectionAnchorList' });

// "Any pixel of the row is visible" — flips the active anchor the moment a new
// section's first row enters the viewport. Module-level so the prop reference is
// stable across renders (RN warns on a changing viewabilityConfig).
const ANCHOR_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 1, minimumViewTime: 0 } as const;

export interface AnchorSection<T> {
  id: string;
  /** What renders in the anchor pill. `icon` is optional — label-only is fine. */
  anchor: { icon?: ReactNode; label: string; testID?: string };
  data: T[];
  /**
   * Optional section-header row rendered above the section's items. Use
   * for a label, divider, or any content that should anchor the section.
   * When omitted, the section is demarcated by the anchor pill alone
   * (fine for emoji-style UX where the tab IS the label).
   */
  renderHeader?: () => ReactNode;
}

interface SectionAnchorListProps<T> {
  sections: AnchorSection<T>[];
  /** Per-item renderer. Used when `rowChunkSize` is 1 (the default). */
  renderItem: (item: T, sectionId: string) => ReactNode;
  /**
   * Per-row renderer. Required when `rowChunkSize > 1` — the caller
   * lays out the chunk's items horizontally (e.g. a 6-cell flex row).
   * Headers always render at full width regardless.
   */
  renderRow?: (items: T[], sectionId: string, rowIndex: number) => ReactNode;
  /**
   * Items per row. Default 1 (one item per row). For grids, set > 1
   * so each rendered row contains N items — the *row* is the unit of
   * virtualization, not the individual cell. Required to be paired
   * with `renderRow`.
   */
  rowChunkSize?: number;
  keyExtractor: (item: T, sectionId: string) => string;
  /**
   * Content rendered above the anchor bar (HistoryEntryHeader,
   * SheetHeader, etc.). Rendered transparently over the top of the
   * scroll area so rows fade behind it as they scroll past.
   */
  aboveAnchors?: ReactNode;
  /**
   * When non-null, the sections view is replaced wholesale by this node
   * and the anchor bar hides. Used for search-results mode in the emoji
   * picker. Callers that need virtualization in this branch should
   * compose their own `FlashList` here.
   */
  overrideContent?: ReactNode;
  /** Bottom content-container padding — clears a floating bottom bar. */
  contentBottomInset?: number;
  /**
   * Injected scroll container. Defaults to react-native's `ScrollView`.
   * Pass `BottomSheetScrollView` when rendering inside @gorhom/bottom-sheet
   * to preserve gesture + keyboard handling — FlashList uses this as
   * its `renderScrollComponent` so the sheet sees the same scroll node
   * it would for a plain `<BottomSheetScrollView>`.
   */
  ScrollComponent?: ComponentType<ScrollViewProps & { ref?: React.Ref<unknown> }>;
  /** Color the top fade tapers to. Defaults to theme `background`. */
  topFadeColor?: string;
  /**
   * Extra style applied to the anchor bar's outer wrapper. Useful when
   * the component sits inside a full-bleed container and needs its own
   * left/right/top insets.
   */
  anchorBarStyle?: StyleProp<ViewStyle>;
  /**
   * Extra style on the FlashList's `contentContainerStyle`. Useful for
   * `paddingHorizontal` when the rendered rows shouldn't carry their
   * own inset. Merged with this component's own paddingTop/paddingBottom.
   */
  listContentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * External state that affects how rows render but isn't part of `sections`.
   * FlashList recycles rows and skips re-invoking `renderItem` for mounted
   * rows when the `data` ref is unchanged. Pass anything that should force a
   * re-render here (selection sets, filter flags, etc.) — same convention as
   * FlatList.
   */
  extraData?: unknown;
}

const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 400;
/** Breathing room between the bottom of the chrome (tabs) and the first
 *  visible content row at scroll offset 0. */
const HEADROOM = 12;
/** Portion of the anchor bar used for the gradient taper. */
const FADE_RATIO = 0.5;

function listKeyExtractor<T>(item: FlatRow<T>): string {
  if (item.kind === 'header') return `header-${item.sectionId}`;
  return item.rowKey;
}

function getItemType<T>(item: FlatRow<T>): string {
  return item.kind;
}

type FlatRow<T> =
  | { kind: 'header'; sectionId: string; render: () => ReactNode }
  | { kind: 'row'; sectionId: string; items: T[]; rowIndex: number; rowKey: string };

export function SectionAnchorList<T>({
  sections,
  renderItem,
  renderRow,
  rowChunkSize = 1,
  keyExtractor,
  aboveAnchors,
  overrideContent,
  contentBottomInset = 24,
  ScrollComponent,
  topFadeColor,
  anchorBarStyle,
  listContentContainerStyle,
  extraData,
}: SectionAnchorListProps<T>) {
  // Track render count + per-render timing so a stress run shows up as
  // either lots of renders (state churn) or as a slow single render
  // (heavy `flatItems` rebuild). Threshold 50: tabbed pickers should
  // not exceed that during normal use, so a higher count escalates to
  // `warn` automatically.
  useRenderLogger('SectionAnchorList', 50, sectionListLog);

  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  const [activeAnchor, setActiveAnchor] = useState<string | undefined>(sections[0]?.id);
  const listRef = useRef<FlashListRef<FlatRow<T>>>(null);
  const tabScrollRef = useRef<ScrollView | null>(null);
  const tabOffsets = useRef<Record<string, { x: number; width: number }>>({});
  const programmaticScroll = useRef(false);
  // Timestamp when a programmatic scroll began — paired with the
  // suppression-window timeout to log scrollToIndex round-trip duration.
  const programmaticScrollStart = useRef(0);

  // Measure the chrome (aboveAnchors + anchorBar) so the scroll
  // content padding can clear it. The chrome is absolute-positioned
  // over the scroll viewport and carries a `ScrollEdgeFade` backdrop.
  const [aboveAnchorsHeight, setAboveAnchorsHeight] = useState(0);
  const [anchorBarHeight, setAnchorBarHeight] = useState(0);
  const chromeHeight = aboveAnchorsHeight + anchorBarHeight;

  const handleAboveAnchorsLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setAboveAnchorsHeight((prev) => {
      if (Math.abs(prev - h) <= 1) return prev;
      sectionListLog.debug('sectionList.chrome.aboveAnchors', { from: prev, to: h });
      return h;
    });
  };

  const handleAnchorBarLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setAnchorBarHeight((prev) => {
      if (Math.abs(prev - h) <= 1) return prev;
      sectionListLog.debug('sectionList.chrome.anchorBar', { from: prev, to: h });
      return h;
    });
  };

  // Keep the active anchor valid when the section list itself changes
  // (e.g. a section empties out and disappears from `sections`). If the
  // currently-active section is gone, fall back to the first available.
  const firstSectionId = sections[0]?.id;
  useEffect(() => {
    if (!activeAnchor) {
      if (firstSectionId) setActiveAnchor(firstSectionId);
      return;
    }
    if (!sections.some((s) => s.id === activeAnchor)) {
      setActiveAnchor(firstSectionId);
    }
  }, [sections, activeAnchor, firstSectionId]);

  // When the active anchor changes, scroll the anchor bar horizontally
  // to keep it in view. Matches emoji-picker tab-centering behaviour.
  useEffect(() => {
    if (!activeAnchor) return;
    const tab = tabOffsets.current[activeAnchor];
    if (tab && tabScrollRef.current) {
      const x = Math.max(0, tab.x - 18);
      tabScrollRef.current.scrollTo({ x, animated: true });
    }
  }, [activeAnchor]);

  // Flatten sections into a single virtualizable row stream. Each
  // section's optional `renderHeader` becomes a `header` row; its
  // `data` is split into `rowChunkSize`-sized chunks, each becoming
  // a `row` row. `sectionFirstIndex` maps a sectionId to the index
  // of its first row in `flatItems` — used by `scrollToIndex` on
  // anchor-pill taps.
  const { flatItems, sectionFirstIndex } = (() => {
    const start = Date.now();
    const items: FlatRow<T>[] = [];
    const firstIndex: Record<string, number> = {};
    for (const section of sections) {
      let firstRowForSection: number | undefined;
      if (section.renderHeader) {
        firstRowForSection = items.length;
        items.push({ kind: 'header', sectionId: section.id, render: section.renderHeader });
      }
      const chunkSize = Math.max(1, rowChunkSize);
      for (let i = 0; i < section.data.length; i += chunkSize) {
        const chunk = section.data.slice(i, i + chunkSize);
        const rowIndex = i / chunkSize;
        const firstKey = keyExtractor(chunk[0]!, section.id);
        const rowKey = chunkSize === 1 ? firstKey : `${section.id}-row-${rowIndex}-${firstKey}`;
        if (firstRowForSection === undefined) firstRowForSection = items.length;
        items.push({
          kind: 'row',
          sectionId: section.id,
          items: chunk,
          rowIndex,
          rowKey,
        });
      }
      if (firstRowForSection !== undefined) {
        firstIndex[section.id] = firstRowForSection;
      }
    }
    const elapsed = Date.now() - start;
    // The flatten happens whenever `sections` / `rowChunkSize` /
    // `keyExtractor` identity changes. If this runs hot, it's almost
    // always because the caller is rebuilding `sections` every render.
    sectionListLog.debug('sectionList.flatten', {
      sectionsIn: sections.length,
      flatRowsOut: items.length,
      headers: items.filter((it) => it.kind === 'header').length,
      rows: items.filter((it) => it.kind === 'row').length,
      elapsedMs: elapsed,
    });
    return { flatItems: items, sectionFirstIndex: firstIndex };
  })();

  // One-shot mount log + the inverse for unmount. Captures the size of
  // the dataset so log-doctor's `stats` mode can correlate later events
  // to the picker config.
  useEffect(() => {
    const totalDataItems = sections.reduce((acc, s) => acc + s.data.length, 0);
    sectionListLog.info('sectionList.mount', {
      sections: sections.length,
      totalDataItems,
      flatRows: flatItems.length,
      rowChunkSize,
      hasOverride: overrideContent != null,
    });
    return () => {
      sectionListLog.info('sectionList.unmount', {});
    };
    // Deliberately mount-only — re-running on every dep change would
    // spam `mount` events whenever the caller built a new `sections`
    // identity. The deeper diagnostic for that case is `sectionList.flatten`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the anchor bar visible during the override path (e.g. emoji
  // search results) so the chrome stays visually continuous as the
  // body content flips. The tabs are not actionable while the override
  // is active — tapping one is a no-op since `scrollToIndex` only
  // operates on the section flatlist — but the visual continuity is
  // worth more than hiding them. Caller can clear the override (close
  // the search) to re-enable tab interaction.
  const showAnchors = sections.length > 0;

  // Viewport "top" for list-reading purposes is just below the chrome
  // + headroom — same offset value drives the FlashList's scroll
  // content paddingTop AND the `viewOffset` on `scrollToIndex`.
  const viewportTopOffset = chromeHeight + HEADROOM;

  const activeAnchorRef = useRef(activeAnchor);
  useEffect(() => {
    activeAnchorRef.current = activeAnchor;
  }, [activeAnchor]);

  // Active-anchor: pick the topmost visible row's sectionId. FlashList
  // sorts `viewableItems` by index, so [0] is the topmost in-view row.
  // Suppressed during programmatic scrolls so the animation doesn't
  // trip self-reinforcing setActiveAnchor() updates.
  //
  // Ref-pattern for `activeAnchor` so the callback reads only stable refs:
  // reading the state directly would give the handler a fresh identity on
  // every anchor flip → FlashList sees a new `onViewableItemsChanged` prop →
  // re-runs viewability tracking. Empirically that added ~1 FlashList
  // re-render per flip and amplified scroll-time JS thread blocks.
  const handleViewableItemsChanged = ({
    viewableItems,
  }: {
    viewableItems: ViewToken<FlatRow<T>>[];
  }) => {
    if (programmaticScroll.current) return;
    if (viewableItems.length === 0) return;
    const top = viewableItems[0]!;
    const row = top.item;
    const sectionId = row?.sectionId;
    if (sectionId && sectionId !== activeAnchorRef.current) {
      sectionListLog.debug('sectionList.viewable.flip', {
        from: activeAnchorRef.current,
        to: sectionId,
        viewableCount: viewableItems.length,
        topIndex: top.index,
      });
      setActiveAnchor(sectionId);
    }
  };

  const handleAnchorPress = (id: string) => {
    setActiveAnchor(id);
    const idx = sectionFirstIndex[id];
    if (idx == null) {
      sectionListLog.warn('sectionList.scrollTo.miss', { sectionId: id });
      return;
    }
    programmaticScroll.current = true;
    programmaticScrollStart.current = Date.now();
    sectionListLog.info('sectionList.scrollTo', {
      sectionId: id,
      index: idx,
      viewOffset: viewportTopOffset,
    });
    // viewOffset shifts the destination so the target row settles
    // BELOW the chrome (at y = viewportTopOffset from the viewport
    // top edge), instead of behind it.
    void listRef.current?.scrollToIndex({
      index: idx,
      animated: true,
      viewOffset: viewportTopOffset,
    });
    setTimeout(() => {
      programmaticScroll.current = false;
      sectionListLog.debug('sectionList.scrollTo.complete', {
        sectionId: id,
        durationMs: Date.now() - programmaticScrollStart.current,
      });
    }, PROGRAMMATIC_SCROLL_SUPPRESS_MS);
  };

  // Merge component-managed paddingTop/paddingBottom with caller-supplied
  // listContentContainerStyle (the latter typically carries
  // paddingHorizontal). Computed lazily so a paddingHorizontal change
  // doesn't invalidate the chrome-height memo.
  const listContentContainerStyleMerged = StyleSheet.flatten([
    listContentContainerStyle,
    { paddingTop: viewportTopOffset, paddingBottom: contentBottomInset },
  ]);

  // Counter incremented every time FlashList invokes `renderListItem`
  // — i.e. every time a row enters the recycling pool with new data.
  // Logged in a throttled effect below so we can see "recycler invokes
  // per second" without flooding the log on each call.
  const recycleCount = useRef(0);
  const lastRecycleLog = useRef(0);

  // Per-row renderer for FlashList. Headers render `section.renderHeader()`
  // wholesale; rows dispatch to `renderRow` (chunked) or `renderItem` (single).
  const renderListItem = ({ item }: ListRenderItemInfo<FlatRow<T>>) => {
    recycleCount.current += 1;
    const now = Date.now();
    // Throttle to one log per second so a burst of recycling shows
    // up as a single rate-summary entry instead of N entries.
    if (now - lastRecycleLog.current >= 1000) {
      const rate = recycleCount.current;
      recycleCount.current = 0;
      lastRecycleLog.current = now;
      if (rate > 0) {
        sectionListLog.debug('sectionList.recycle.rate', { invokesLastSec: rate });
      }
    }
    let content: ReactNode = null;
    if (item.kind === 'header') {
      content = item.render();
    } else if (rowChunkSize > 1) {
      content = renderRow ? renderRow(item.items, item.sectionId, item.rowIndex) : null;
    } else {
      const single = item.items[0];
      content = single === undefined ? null : renderItem(single, item.sectionId);
    }

    return <>{content}</>;
  };

  // `renderScrollComponent` lets the host inject its scroll container
  // (e.g. `BottomSheetScrollView` for gorhom integration). Default to
  // the standard react-native ScrollView when no host wraps us.
  // KEPT as an explicit useMemo: this creates a component type — if its
  // identity ever changed between renders FlashList would remount its
  // scroll container (scroll position reset). Compiler memoization is an
  // optimization, not a contract; the explicit memo makes it one.
  // ast-grep-ignore: no-manual-memo-tsx
  const renderScrollComponent = useMemo(() => {
    if (!ScrollComponent) return undefined;
    const Inner = ScrollComponent;
    const Component = (props: ScrollViewProps) => <Inner {...props} />;
    Component.displayName = 'SectionAnchorListScrollComponent';
    return Component;
  }, [ScrollComponent]);

  return (
    <View style={{ flex: 1 }}>
      {/* Body — virtualized FlashList for sections, or wholesale
          `overrideContent` (e.g. search-results mode). Chrome is
          absolute-positioned over the top edge regardless. */}
      {overrideContent != null ? (
        // The override path needs the same paddingTop the FlashList
        // would have applied, so caller-rendered content also clears
        // the chrome.
        <View style={{ flex: 1, paddingTop: viewportTopOffset }}>{overrideContent}</View>
      ) : (
        <FlashList
          ref={listRef}
          data={flatItems}
          renderItem={renderListItem}
          keyExtractor={listKeyExtractor}
          getItemType={getItemType}
          extraData={extraData}
          // Tuned down from 250 → 150 after a stress test showed that
          // continuous fast scroll across many sections caused 6s+ JS
          // thread blocks: the bigger the over-render buffer, the more
          // rows the list synchronously reconciles per scroll frame.
          // 150px = ~4 rows ahead of the viewport at 40px row height —
          // enough to avoid blank flashes at typical scroll velocities,
          // small enough that fast flicks don't pre-render a long tail.
          drawDistance={150}
          contentContainerStyle={listContentContainerStyleMerged}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={ANCHOR_VIEWABILITY_CONFIG}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderScrollComponent={renderScrollComponent}
        />
      )}

      {/* Top chrome — absolute over the body. ScrollEdgeFade is the
          backdrop (frosted-glass blur with eased mask + color gradient
          so the bottom edge tapers into the scroll). aboveAnchors +
          tab bar render on top. */}
      <View pointerEvents="box-none" style={styles.chromeAbsolute}>
        <ScrollEdgeFade
          edge="top"
          height={chromeHeight > 0 ? chromeHeight : 1}
          fadeSize={
            anchorBarHeight > 0
              ? Math.max(1, Math.round(anchorBarHeight * FADE_RATIO))
              : chromeHeight
          }
          color={topFadeColor}
          zIndex={0}
        />
        <View pointerEvents="box-none" style={{ zIndex: zIndex.raised }}>
          {aboveAnchors != null && <View onLayout={handleAboveAnchorsLayout}>{aboveAnchors}</View>}
          {showAnchors && (
            <View onLayout={handleAnchorBarLayout} style={[styles.anchorBarOuter, anchorBarStyle]}>
              <ScrollView
                ref={tabScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.anchorBarWrapper}
                contentContainerStyle={styles.anchorBarContent}>
                {sections.map((s) => {
                  const isSelected = activeAnchor === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      testID={s.anchor.testID}
                      onPress={() => handleAnchorPress(s.id)}
                      onLayout={(e) => {
                        tabOffsets.current[s.id] = {
                          x: e.nativeEvent.layout.x,
                          width: e.nativeEvent.layout.width,
                        };
                      }}
                      activeOpacity={0.7}
                      style={[
                        styles.anchorPill,
                        { backgroundColor: isSelected ? surfaceTertiary : 'transparent' },
                      ]}>
                      {s.anchor.icon}
                      <Text
                        size={12}
                        bold
                        style={{ color: isSelected ? foreground : withAlpha(foreground, 0.7) }}>
                        {s.anchor.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chromeAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: zIndex.sticky,
  },
  anchorBarOuter: {
    paddingTop: 12,
  },
  anchorBarWrapper: {
    marginHorizontal: -18,
    flexGrow: 0,
  },
  anchorBarContent: {
    gap: 4,
    paddingHorizontal: 18,
  },
  anchorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 1000,
  },
});
