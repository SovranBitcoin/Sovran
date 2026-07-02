import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { PrimaryBalance, type PillVisibility } from '@/features/wallet/components/PrimaryBalance';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { resolveUnitWallpaper } from '@/shared/lib/theme/resolveUnitWallpaper';
import {
  cancelThemeDrag,
  releaseThemeDrag,
  surfaceOfTheme,
} from '@/shared/lib/theme/themeTransition';

import { Log, walletLog } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

const BALANCE_BOTTOM_INSET = 24;

interface AccountProps {
  // Phone-dimension floor for the balance region. The region grows naturally
  // with its contents (e.g. the PENDING/RESERVED/REDEEMING pills) above this
  // minimum, so nothing clips when pills are present and it stays visually
  // balanced when they're absent.
  minHeight: number;
}

/** The unit's wallpaper theme from the CURRENT store snapshots — called from
 *  the scroll handler, so no hook subscription churn. */
function themeForUnit(unit: string): string {
  const { unitWallpapers, activeAlbumSlug } = useThemeStore.getState();
  const catalog = useWallpaperStore.getState().catalog;
  return resolveUnitWallpaper(unit, { unitWallpapers, activeAlbumSlug }, catalog);
}

/**
 * The wallet-account carousel: one page per available unit (Bitcoin / USD /
 * EUR / GBP account), swipeable on iOS and Android (react-native-pager-view).
 *
 * The theme transition is DRAG-DRIVEN: the moment a drag moves toward a
 * neighbour, that account's wallpaper layer mounts (beginThemeDrag) and the
 * crossfade + surface-color interpolation track the drag fraction frame by
 * frame (themeDragProgress). Settling on the new page runs `selectUnit`
 * (which also re-points the preferred mint when needed) and ThemeProvider
 * applies the vars instantly under the already-opaque drag layer; springing
 * back cancels the drag and glides home.
 */
export function Account({ minHeight }: AccountProps): React.ReactElement {
  const { unit, availableUnits, selectUnit } = useActiveUnit();
  const pagerRef = useRef<PagerView>(null);
  const pageIndex = Math.max(0, availableUnits.indexOf(unit));
  // Tracks the page the PAGER currently sits on, so external unit changes
  // move the pager but pager-driven changes don't re-set the same page.
  const pagerPositionRef = useRef(pageIndex);

  useEffect(() => {
    if (pagerPositionRef.current === pageIndex) return;
    pagerRef.current?.setPage(pageIndex);
  }, [pageIndex]);

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

  // Revolut model: the wallpaper crossfade starts at RELEASE, not at the
  // pager's 50% snap threshold. onPageSelected fires mid-drag when the
  // landing page crosses the threshold, so it only RECORDS the landing —
  // the fade triggers on the dragging→settling state transition (the finger
  // actually leaving), and the unit commits at idle. Catching the pager
  // mid-settle and dragging again cancels the fade cleanly.
  const scrollStateRef = useRef<'idle' | 'dragging' | 'settling'>('idle');

  const maybeStartReleaseFade = useCallback(() => {
    const position = pagerPositionRef.current;
    const nextUnit = availableUnits[position];
    if (!nextUnit || nextUnit === unit) {
      cancelThemeDrag();
      return;
    }
    const fromTheme = themeForUnit(unit);
    const targetTheme = themeForUnit(nextUnit);
    if (targetTheme === fromTheme) return; // identical wallpaper — no fade
    releaseThemeDrag(targetTheme, surfaceOfTheme(fromTheme));
  }, [availableUnits, unit]);

  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      pagerPositionRef.current = event.nativeEvent.position;
      // The landing page can be (re)determined AFTER release while the pager
      // is already settling — retarget the running fade to match.
      if (scrollStateRef.current === 'settling') maybeStartReleaseFade();
    },
    [maybeStartReleaseFade]
  );

  const handlePageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      const state = event.nativeEvent.pageScrollState;
      scrollStateRef.current = state;
      if (state === 'dragging') {
        // Finger back on a settling pager — abandon the running fade.
        cancelThemeDrag();
        return;
      }
      if (state === 'settling') {
        maybeStartReleaseFade();
        return;
      }
      // idle — commit.
      const position = pagerPositionRef.current;
      const nextUnit = availableUnits[position];
      if (!nextUnit || nextUnit === unit) {
        cancelThemeDrag();
        return;
      }
      walletLog.info('wallet.account.carousel_selected', { from: unit, to: nextUnit, position });
      selectUnit(nextUnit);
    },
    [availableUnits, unit, selectUnit, maybeStartReleaseFade]
  );

  return (
    <Log name="Account">
      <View style={[styles.container, { height: containerHeight }]}>
        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={pageIndex}
          onPageSelected={handlePageSelected}
          onPageScrollStateChanged={handlePageScrollStateChanged}
          // Rebuild when the available-account set changes so page indices
          // stay aligned with availableUnits.
          key={availableUnits.join('|')}>
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
        </PagerView>
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
