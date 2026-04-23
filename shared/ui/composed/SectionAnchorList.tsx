/**
 * @fileoverview Section-anchored scrollable list.
 *
 * A generic section list where tapping an anchor pill in the horizontal
 * bar above the content scrolls the list to that section, and the active
 * anchor highlights as the user scrolls. The top chrome (anchor bar +
 * optional `aboveAnchors` block such as a `HistoryEntryHeader` or modal
 * header) sits transparently over the scroll area — rows scrolling past
 * fade out via a gradient before passing "behind" the chrome.
 *
 * Extracted from the emoji picker's pattern
 * (`shared/lib/popup/sheets/emoji-picker/content.tsx`) so the same UX
 * can ship on the Split-Bill participant picker without duplicating the
 * offset-tracking + scroll-to-section plumbing.
 *
 * Design notes:
 *   - Plain ScrollView (or a caller-injected equivalent like
 *     BottomSheetScrollView) — not a SectionList / FlatList / LegendList.
 *     The offset-tracking pattern requires every section wrapper to be
 *     mounted, which virtualisation breaks. Both existing consumers
 *     render <100 rows, so the lack of virtualisation is fine.
 *   - Active-anchor tracking uses offset math + a ~400ms suppression
 *     window after a programmatic `scrollTo`, mirroring the emoji
 *     picker's original logic to avoid feedback loops.
 *   - `overrideContent` lets callers swap the sections view wholesale
 *     (e.g. search-results mode). When non-null, the anchor bar hides
 *     too, matching emoji-picker semantics.
 *   - The top chrome is measured via onLayout on both `aboveAnchors` and
 *     the anchor bar; the scroll area tucks under both with a negative
 *     margin so rows fade into the chrome via the gradient overlay.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import opacity from 'hex-color-opacity';

import { ScrollEdgeFade } from './ScrollEdgeFade';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface AnchorSection<T> {
  id: string;
  /** What renders in the anchor pill. `icon` is optional — label-only is fine. */
  anchor: { icon?: ReactNode; label: string; testID?: string };
  data: T[];
  /**
   * Optional section-header row rendered above the items. When omitted,
   * no header renders (the section is demarcated by the anchor pill
   * only — fine for emoji-style UX).
   */
  renderHeader?: () => ReactNode;
}

export interface SectionAnchorListProps<T> {
  sections: AnchorSection<T>[];
  renderItem: (item: T, sectionId: string) => ReactNode;
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
   * picker; any similar "flip to alternate content" use case fits.
   */
  overrideContent?: ReactNode;
  /** Bottom content-container padding — clears a floating bottom bar. */
  contentBottomInset?: number;
  /**
   * Injected scroll container. Defaults to react-native's `ScrollView`.
   * Pass `BottomSheetScrollView` when rendering inside @gorhom/bottom-sheet
   * to preserve gesture + keyboard handling.
   */
  ScrollComponent?: ComponentType<ScrollViewProps & { ref?: React.Ref<unknown> }>;
  /** Color the top fade tapers to. Defaults to theme `background`. */
  topFadeColor?: string;
  /** Hysteresis band (px) for active-anchor detection. Default 40. */
  activeThreshold?: number;
  /**
   * Extra style applied to the anchor bar's outer wrapper. Useful when
   * the component sits inside a full-bleed container and needs its own
   * left/right/top insets to align with the surrounding content (e.g. the
   * Split-Bill participants screen, where `HistoryEntryHeader` has 20px
   * horizontal padding but the scroll area itself does not). The style
   * is included in the measured chrome height, so the fade math stays
   * correct.
   */
  anchorBarStyle?: StyleProp<ViewStyle>;
}

const DEFAULT_ACTIVE_THRESHOLD = 40;
const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 400;
/** Breathing room between the bottom of the chrome (tabs) and the first
 *  visible content row at scroll offset 0 — also the resting position
 *  when the user taps an anchor. */
const HEADROOM = 12;
/** Portion of the anchor bar used for the gradient taper (the remainder
 *  above stays fully opaque). Smaller = sharper ramp to opaque. */
const FADE_RATIO = 0.5;

export function SectionAnchorList<T>({
  sections,
  renderItem,
  keyExtractor,
  aboveAnchors,
  overrideContent,
  contentBottomInset = 24,
  ScrollComponent = ScrollView as unknown as ComponentType<
    ScrollViewProps & { ref?: React.Ref<unknown> }
  >,
  topFadeColor,
  activeThreshold = DEFAULT_ACTIVE_THRESHOLD,
  anchorBarStyle,
}: SectionAnchorListProps<T>) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  const [activeAnchor, setActiveAnchor] = useState<string | undefined>(sections[0]?.id);
  const scrollRef = useRef<ScrollView | null>(null);
  const tabScrollRef = useRef<ScrollView | null>(null);
  const sectionOffsets = useRef<Record<string, number>>({});
  const tabOffsets = useRef<Record<string, { x: number; width: number }>>({});
  const programmaticScroll = useRef(false);

  // Measure the chrome (aboveAnchors + anchorBar) so we can tuck the
  // scroll content under it. The scroll view gets a negative top margin
  // of chromeHeight plus a matching paddingTop, so the first row sits
  // flush with the chrome's bottom. The gradient overlay covers the
  // chrome region and tapers across the anchor-bar band: aboveAnchors
  // stays fully opaque; rows fade out while passing the tabs.
  const [aboveAnchorsHeight, setAboveAnchorsHeight] = useState(0);
  const [anchorBarHeight, setAnchorBarHeight] = useState(0);
  const chromeHeight = aboveAnchorsHeight + anchorBarHeight;

  const handleAboveAnchorsLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setAboveAnchorsHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  const handleAnchorBarLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setAnchorBarHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

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

  // When the active anchor changes, scroll the anchor bar horizontally to
  // keep it in view. Matches emoji-picker tab-centering behaviour.
  useEffect(() => {
    if (!activeAnchor) return;
    const tab = tabOffsets.current[activeAnchor];
    if (tab && tabScrollRef.current) {
      const x = Math.max(0, tab.x - 18);
      tabScrollRef.current.scrollTo({ x, animated: true });
    }
  }, [activeAnchor]);

  const handleSectionLayout = useCallback((sectionId: string, y: number) => {
    sectionOffsets.current[sectionId] = y;
  }, []);

  // The viewport's "top" for list-reading purposes is just below the
  // chrome + headroom — all offset math is expressed relative to that
  // point so scrollTo and active detection agree.
  const viewportTopOffset = chromeHeight + HEADROOM;

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (programmaticScroll.current) return;
      const y = e.nativeEvent.contentOffset.y;
      let current = sections[0]?.id;
      for (const s of sections) {
        const offset = sectionOffsets.current[s.id];
        if (offset != null && offset <= y + viewportTopOffset + activeThreshold) {
          current = s.id;
        }
      }
      if (current && current !== activeAnchor) {
        setActiveAnchor(current);
      }
    },
    [sections, activeAnchor, activeThreshold, viewportTopOffset]
  );

  const handleAnchorPress = useCallback(
    (id: string) => {
      setActiveAnchor(id);
      const offset = sectionOffsets.current[id];
      if (offset != null && scrollRef.current) {
        programmaticScroll.current = true;
        scrollRef.current.scrollTo({
          y: Math.max(0, offset - viewportTopOffset),
          animated: true,
        });
        setTimeout(() => {
          programmaticScroll.current = false;
        }, PROGRAMMATIC_SCROLL_SUPPRESS_MS);
      }
    },
    [viewportTopOffset]
  );

  const showAnchors = !overrideContent && sections.length > 0;

  // `paddingTop: chromeHeight + HEADROOM` — first row sits below the
  // chrome with a small breathing gap. The fade overlay covers only the
  // chrome region (height: chromeHeight) so the HEADROOM band between
  // the chrome and the first row is fully clear.
  const contentContainerStyle = useMemo(
    () => ({
      paddingTop: viewportTopOffset,
      paddingBottom: contentBottomInset,
    }),
    [viewportTopOffset, contentBottomInset]
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Top chrome layer — transparent by default, sits at zIndex 20
          above the scroll area. Content fades behind it via the
          gradient overlay below. */}
      <View style={styles.chrome}>
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
                  <TouchableOpacity
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
                      style={{ color: isSelected ? foreground : opacity(foreground, 0.7) }}>
                      {s.anchor.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Scroll content — tucks under the chrome via negative top margin
          so rows can scroll behind it. First row sits a small gap below
          the chrome bottom; the fade overlay covers the chrome region,
          with the taper confined to the lower ~half of the anchor bar
          so the ramp to opaque is quick and sits within the tab strip. */}
      <View style={{ flex: 1, marginTop: -chromeHeight }}>
        <ScrollEdgeFade
          edge="top"
          height={chromeHeight}
          fadeSize={
            anchorBarHeight > 0
              ? Math.max(1, Math.round(anchorBarHeight * FADE_RATIO))
              : chromeHeight
          }
          color={topFadeColor}
          zIndex={10}
        />
        <ScrollComponent
          ref={scrollRef as React.Ref<unknown>}
          style={{ flex: 1 }}
          contentContainerStyle={contentContainerStyle}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {overrideContent ??
            sections.map((section) => (
              <View
                key={section.id}
                onLayout={(e) => handleSectionLayout(section.id, e.nativeEvent.layout.y)}>
                {section.renderHeader?.()}
                {section.data.map((item) => (
                  <React.Fragment key={keyExtractor(item, section.id)}>
                    {renderItem(item, section.id)}
                  </React.Fragment>
                ))}
              </View>
            ))}
        </ScrollComponent>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    zIndex: 20,
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
