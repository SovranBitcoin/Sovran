import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { PrimaryBalance } from '@/features/wallet/components/PrimaryBalance';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';

import { Log, walletLog } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

const BALANCE_BOTTOM_INSET = 24;

interface AccountProps {
  // Phone-dimension floor for the balance region. The region grows naturally
  // with its contents (e.g. the PENDING/RESERVED/REDEEMING pills) above this
  // minimum, so nothing clips when pills are present and it stays visually
  // balanced when they're absent. The boot-splash → QR morph stays correct
  // because the splash gate remeasures the QR position (requestQRButtonRemeasure)
  // right before morphing, so a content-driven height is safe.
  minHeight: number;
}

/**
 * The wallet-account carousel: one page per available unit (Bitcoin / USD /
 * EUR / GBP account), swipeable on iOS and Android (react-native-pager-view).
 * Settling on a page runs `selectUnit`, which also re-points the preferred
 * mint when the current one can't serve the unit — the same rule as picking
 * from the Wallet-accounts menu — and the active-unit change drives the
 * wallpaper/theme transition. External unit changes (menu pick, mint-change
 * sync) scroll the carousel to match.
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

  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const position = event.nativeEvent.position;
      pagerPositionRef.current = position;
      const nextUnit = availableUnits[position];
      if (!nextUnit || nextUnit === unit) return;
      walletLog.info('wallet.account.carousel_selected', { from: unit, to: nextUnit, position });
      selectUnit(nextUnit);
    },
    [availableUnits, unit, selectUnit]
  );

  return (
    <Log name="Account">
      <View style={[styles.container, { minHeight }]}>
        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={pageIndex}
          onPageSelected={handlePageSelected}
          // Rebuild when the available-account set changes so page indices
          // stay aligned with availableUnits.
          key={availableUnits.join('|')}>
          {availableUnits.map((accountUnit) => (
            <View key={accountUnit} collapsable={false}>
              <VStack style={styles.balanceSlot}>
                <VStack align="center" gap={8}>
                  <PrimaryBalance account={{ unit: accountUnit }} />
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
