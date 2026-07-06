import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import Animated, { useEvent, useHandler } from 'react-native-reanimated';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { PrimaryBalance, type PillVisibility } from '@/features/wallet/components/PrimaryBalance';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { resolveUnitWallpaper } from '@/shared/lib/theme/resolveUnitWallpaper';
import { carouselX, setCarouselPages } from '@/shared/lib/theme/themeTransition';

import { Log, walletLog } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

const BALANCE_BOTTOM_INSET = 24;

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

/** The onPageScroll payload as reanimated's useEvent delivers it (flattened
 *  nativeEvent plus the eventName tag). */
interface PagerScrollWorkletEvent extends Record<string, unknown> {
  position: number;
  offset: number;
  eventName: string;
}

/** Reanimated worklet handler for the pager's native onPageScroll stream
 *  (the standard useHandler/useEvent adapter from the pager-view docs). */
function usePagerScrollHandler(
  handlers: {
    onPageScroll: (event: PagerScrollWorkletEvent, context: Record<string, unknown>) => void;
  },
  dependencies: unknown[]
) {
  const { context, doDependenciesDiffer } = useHandler(handlers, dependencies);
  return useEvent<PagerScrollWorkletEvent>(
    (event) => {
      'worklet';
      const { onPageScroll } = handlers;
      if (onPageScroll && event.eventName.endsWith('onPageScroll')) {
        onPageScroll(event, context);
      }
    },
    ['onPageScroll'],
    doDependenciesDiffer
  );
}

interface AccountProps {
  // Phone-dimension floor for the balance region. The region grows naturally
  // with its contents (e.g. the PENDING/RESERVED/REDEEMING pills) above this
  // minimum, so nothing clips when pills are present and it stays visually
  // balanced when they're absent.
  minHeight: number;
}

/**
 * The wallet-account carousel: one page per available unit (Bitcoin / USD /
 * EUR / GBP account), swipeable on iOS and Android (react-native-pager-view).
 *
 * The wallpaper transition is POSITION-DRIVEN: this pager registers its
 * pages (unit + resolved wallpaper) with the theme-transition seam and
 * streams its continuous position into `carouselX` from an onPageScroll
 * worklet. The persistent wallpaper layers in BackgroundView derive their
 * opacities from that one value, so drags, cancels, direction changes, and
 * programmatic setPage animations are all correct with no transition state
 * here. Settling on a new page just commits the unit (`selectUnit`);
 * ThemeProvider applies the CSS vars under an already-correct wallpaper.
 */
export function Account({ minHeight }: AccountProps): React.ReactElement {
  const { unit, availableUnits, selectUnit } = useActiveUnit();
  const pagerRef = useRef<PagerView>(null);
  const pageIndex = Math.max(0, availableUnits.indexOf(unit));
  // Tracks the page the PAGER currently sits on, so external unit changes
  // move the pager but pager-driven changes don't re-set the same page.
  const pagerPositionRef = useRef(pageIndex);
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  useEffect(() => {
    if (pagerPositionRef.current === pageIndex) return;
    // Animated page move — onPageScroll streams the wallpaper crossfade.
    pagerRef.current?.setPage(pageIndex);
  }, [pageIndex]);

  // Register the wallpaper layer stack: one page per unit, in pager order.
  // setCarouselPages dedupes by value, so identity churn in availableUnits
  // or store snapshots is harmless.
  const unitWallpapers = useThemeStore((s) => s.unitWallpapers);
  const activeAlbumSlug = useThemeStore((s) => s.activeAlbumSlug);
  const catalog = useWallpaperStore((s) => s.catalog);
  useEffect(() => {
    setCarouselPages(
      availableUnits.map((pageUnit) => ({
        unit: pageUnit,
        theme: resolveUnitWallpaper(pageUnit, { unitWallpapers, activeAlbumSlug }, catalog),
      }))
    );
  }, [availableUnits, unitWallpapers, activeAlbumSlug, catalog]);
  useEffect(() => () => setCarouselPages([]), []);

  // The pager rebuilds (new native instance at initialPage, no scroll events)
  // whenever the available-unit set changes — snap the wallpaper stack to the
  // new geometry. Deliberately NOT keyed on pageIndex: unit changes animate
  // via setPage above and must not be snapped over.
  const pagerKey = availableUnits.join('|');
  useEffect(() => {
    pagerPositionRef.current = pageIndexRef.current;
    carouselX.value = pageIndexRef.current;
  }, [pagerKey]);

  const maxPageIndex = availableUnits.length - 1;
  const scrollHandler = usePagerScrollHandler(
    {
      onPageScroll: (event) => {
        'worklet';
        // Clamp iOS edge-bounce overshoot so layer 0 / layer N never fade
        // toward an empty backdrop.
        const x = event.position + event.offset;
        carouselX.value = x < 0 ? 0 : x > maxPageIndex ? maxPageIndex : x;
      },
    },
    [maxPageIndex]
  );

  // The carousel's height is the MAX content height across all account pages
  // (pager pages are absolutely positioned, so the container can't grow
  // naturally) — sized to the tallest account, swiping never shifts layout.
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({});
  const tallestContentHeight = Math.max(0, ...Object.values(pageHeights));
  const containerHeight = Math.max(minHeight, tallestContentHeight + BALANCE_BOTTOM_INSET);

  // Deadbanded, mostly-monotonic height tracking. The unit commit repaints
  // every themed element (CSS-var swap) and text metrics can wobble by a
  // pixel — feeding raw onLayout values straight into the container height
  // created a resize → relayout → remeasure loop that read as vertical
  // jitter after each switch. Growth applies immediately (a pill appearing
  // must not clip); shrinks only apply when clearly real (a pill row
  // disappearing), never for sub-pill wobble.
  const HEIGHT_SHRINK_THRESHOLD = 24;
  // Status-pill slot reservation: OR the pill visibility across all account
  // pages, so a pill that shows on ANY page keeps an invisible slot on every
  // page (consistent positions) — while pills nobody shows reserve nothing.
  const [pillsByUnit, setPillsByUnit] = useState<Record<string, PillVisibility>>({});
  const handlePillVisibilityChange = useCallback((pageUnit: string, visibility: PillVisibility) => {
    setPillsByUnit((prev) => {
      const current = prev[pageUnit];
      if (
        current &&
        current.pending === visibility.pending &&
        current.reserved === visibility.reserved &&
        current.redeeming === visibility.redeeming
      ) {
        return prev;
      }
      return { ...prev, [pageUnit]: visibility };
    });
  }, []);
  const reservePillSlots = useMemo<PillVisibility>(() => {
    const all = Object.values(pillsByUnit);
    return {
      pending: all.some((v) => v.pending),
      reserved: all.some((v) => v.reserved),
      redeeming: all.some((v) => v.redeeming),
    };
  }, [pillsByUnit]);

  const onPageContentLayout = useCallback((pageUnit: string, event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    setPageHeights((prev) => {
      const current = prev[pageUnit] ?? 0;
      const grewTaller = height > current;
      const shrankForReal = current - height > HEIGHT_SHRINK_THRESHOLD;
      if (!grewTaller && !shrankForReal) return prev;
      return { ...prev, [pageUnit]: height };
    });
  }, []);

  const handlePageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    pagerPositionRef.current = event.nativeEvent.position;
  }, []);

  const handlePageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      if (event.nativeEvent.pageScrollState !== 'idle') return;
      const position = pagerPositionRef.current;
      // Defensive snap: the final native scroll event should land exactly on
      // the page, but a truncated stream must not leave a hidden layer up.
      carouselX.value = position;
      const nextUnit = availableUnits[position];
      if (!nextUnit || nextUnit === unit) return;
      walletLog.info('wallet.account.carousel_selected', { from: unit, to: nextUnit, position });
      selectUnit(nextUnit);
    },
    [availableUnits, unit, selectUnit]
  );

  return (
    <Log name="Account">
      <View style={[styles.container, { height: containerHeight }]}>
        <AnimatedPagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={pageIndex}
          // Reanimated's useEvent handler and the pager's codegen prop type
          // don't unify — the cast is the documented pager-view pattern.
          onPageScroll={
            scrollHandler as unknown as React.ComponentProps<
              typeof AnimatedPagerView
            >['onPageScroll']
          }
          onPageSelected={handlePageSelected}
          onPageScrollStateChanged={handlePageScrollStateChanged}
          // Rebuild when the available-account set changes so page indices
          // stay aligned with availableUnits.
          key={pagerKey}>
          {availableUnits.map((accountUnit) => (
            <View key={accountUnit} collapsable={false}>
              <VStack style={styles.balanceSlot}>
                <VStack
                  align="center"
                  gap={8}
                  onLayout={(event) => onPageContentLayout(accountUnit, event)}>
                  {/* Each page renders ITS OWN account's full data — balance,
                      pending/reserved pills, fiat conversion — via its own
                      always-mounted subscriptions, so the neighbour that
                      slides into view during a drag is already correct.
                      Heights stay uniform via the max-height container. */}
                  <PrimaryBalance
                    account={{ unit: accountUnit }}
                    reservePillSlots={reservePillSlots}
                    onPillVisibilityChange={handlePillVisibilityChange}
                  />
                </VStack>
              </VStack>
            </View>
          ))}
        </AnimatedPagerView>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: zIndex.sticky,
  },
  pager: {
    flex: 1,
  },
  balanceSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: BALANCE_BOTTOM_INSET,
  },
});
