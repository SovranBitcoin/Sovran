import { useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { usePullToAiRefreshControl } from '@/shared/blocks/PullToAiRefreshControl';

import {
  useHistoryWithMelts,
  ReceivedThisMonth,
  SpentThisMonth,
  Transactions,
} from '@/features/transactions';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { Account } from '@/features/wallet/components/Account';
import { MessageEcashToReview } from '@/features/payments/components/MessageEcashToReview';
import { hasFeature } from '@/shared/config/features';
import { BitcoinNearYou } from '@/features/wallet/components/BitcoinNearYou';
import { BootEntrance } from '@/shared/ui/composed/BootEntrance';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { LayoutShiftProbe } from '@/shared/ui/composed/LayoutShiftProbe';
import { HomeTop } from '@/features/wallet/home/HomeLayouts';
import type { HomeActions } from '@/features/wallet/home/types';
import { useAppStyle } from '@/shared/styles/appStyle';
import { walletScrollY } from '@/features/wallet/lib/walletScroll';
import { View } from '@/shared/ui/primitives/View/View';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHandleCameraPermission } from '@/features/camera';
import { usePaymentFlowMachine } from 'wallet/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useAmbientNfcArm } from '@/features/wallet/hooks/useAmbientNfcArm';
import { useWalletTabFocusPublisher } from '@/features/wallet/hooks/useWalletTabFocusPublisher';
import { Log, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { SearchOverlay } from '@/shared/ui/composed/search/SearchOverlay';
import { toRealUnit } from 'wallet';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import { E2EHerouiMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';
import { E2EReadyProofProbe } from '@/features/wallet/components/E2EReadyProofProbe';
import { WalletSelectedMintProbe } from '@/features/wallet/components/WalletSelectedMintProbe';
import { WalletWallpaperProbe } from '@/features/wallet/components/WalletWallpaperProbe';

// The wallet-screen transaction list shows EVERY account's entries;
// Transactions treats unit 'all' as unfiltered.
const ALL_UNITS_ACCOUNT = { unit: 'all' };
// Android's default header row is 56dp vs iOS's 44pt — shrink the gap by the
// structural delta so the balance sits at the same visual offset.
const WALLET_HEADER_TO_BALANCE_GAP = Platform.select({ android: 12, default: 24 }) as number;

export function WalletScreen() {
  useLifecycleLogger('WalletScreen');
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  // Phone-dimension floor for the balance region. It grows naturally with its
  // contents (PENDING/RESERVED/REDEEMING pills) above this minimum so nothing
  // clips, and stays balanced when empty. The boot-splash → QR morph remeasures
  // the QR position just before morphing, so a content-driven height is safe.
  const minBalanceHeight = Math.max(windowHeight * 0.22, 200);
  const style = useAppStyle();

  const [contentHeight, setContentHeight] = useState(0);
  // A docked layout pins its actions over the scroller; the scroller reserves
  // exactly the bar's measured height so the last row clears it.

  const onContentSizeChange = (_width: number, height: number) => {
    setContentHeight(height);
  };

  // The active mint unit scopes the whole wallet view (balance, machine,
  // history filter, receive/send defaults). Persisted per profile.
  const { unit: activeUnit } = useActiveUnit();
  const account = { unit: activeUnit };

  // ALL units, unfiltered: the transaction list is shared by every carousel
  // account, so switching accounts never reloads it — which was the
  // remaining content shift on commit (the list re-filtered and re-rendered
  // exactly as the unit landed).
  const { history, refresh } = useHistoryWithMelts(100);
  const handlePullToAiRefresh = () => {
    void refresh();
  };
  const pullToAi = usePullToAiRefreshControl({ onRefresh: handlePullToAiRefresh });

  const { handlePermission } = useHandleCameraPermission();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  // While a multi-leg swap is running, every payment-initiating button on
  // this screen is gated. Coco's mint/melt services serialize through a
  // per-instance lock, and the user kicking off a Send/Receive/Swap/Split
  // Bill in parallel can stall the swap or surface "operation already in
  // progress" errors. Greying out is the cheapest user-visible indicator.
  const isSwapping = useSwapStatusStore((s) => s.active?.state === 'running');

  const handleReceive = () => {
    walletLog.info('wallet.action.receive', { unit: account.unit });
    clearPaymentContext('wallet.receive');
    void machine.startReceive({ reset: true });
  };

  const handleScanQR = async () => {
    walletLog.info('wallet.action.scan_qr', { unit: account.unit });
    const granted = await handlePermission();
    if (!granted) {
      walletLog.info('wallet.action.scan_qr_denied');
      return;
    }
    clearPaymentContext('wallet.scan_qr');
    router.navigate({
      pathname: '/camera',
      // Payment routes carry the mint's REAL unit, never the account unit.
      params: { to: 'sendToken', unit: toRealUnit(account.unit) },
    });
  };

  const handleSend = async () => {
    walletLog.info('wallet.action.send', { unit: account.unit });
    clearPaymentContext('wallet.send');
    // Destination-first: open the Send method chooser (QR / Create Ecash / NFC
    // / Nut Drop + destination input + contact search) rather than jumping
    // straight to amount entry. The chosen method drives the rest of the flow.
    await machine.startSend({ reset: true });
  };

  const handleTheme = () => {
    walletLog.info('wallet.theme.tap');
    router.push('/(theme-flow)/preview');
  };

  const handleSplit = () => {
    walletLog.info('wallet.swap.tap', { unit: account.unit });
    router.navigate({
      pathname: '/(mint-flow)/distribution',
      params: { unit: account.unit },
    });
  };

  // Android hybrid tap-to-pay: the ambient focus loop owns NFC scanning.
  // The wallet screen no longer has an NFC button (the affordance lives in
  // the Send modal) but the ambient listener stays armed here so tapping a
  // terminal still works from the home screen.
  useAmbientNfcArm(machine);

  // Feeds the boot splash gate: lets it fast-forward the splash→QR morph
  // overlay if this tab blurs mid-boot (the overlay renders above the tab
  // navigator and would otherwise ghost over feed/notifications).
  useWalletTabFocusPublisher();

  const handleHistory = () => {
    walletLog.info('wallet.history.tap');
    router.navigate('/(transactions-flow)/transactions');
  };

  const handleMap = () => {
    walletLog.info('wallet.map.tap');
    router.navigate('/(map-flow)');
  };

  // Every home action, once. The active style's layout decides where each one
  // sits; none of them re-declares a handler or a testID.
  const actions: HomeActions = {
    receive: {
      id: 'receive',
      label: 'Receive',
      icon: 'lucide:arrow-down-left',
      systemIcon: 'arrow.down.left',
      testID: 'wallet-receive',
      onPress: handleReceive,
    },
    send: {
      id: 'send',
      label: 'Send',
      icon: 'lucide:arrow-up-right',
      systemIcon: 'arrow.up.right',
      testID: 'wallet-send',
      onPress: () => void handleSend(),
    },
    scan: {
      id: 'scan',
      label: 'Scan',
      icon: 'mdi:qrcode-scan',
      testID: 'qr-scan-button',
      onPress: () => void handleScanQR(),
    },
    split: {
      id: 'split',
      label: 'Split',
      menuText: 'Balance split',
      description: 'Rebalance funds across mints',
      icon: 'mdi:swap-horizontal',
      systemIcon: 'arrow.left.arrow.right',
      testID: 'wallet-split',
      disabled: isSwapping,
      onPress: handleSplit,
    },
    theme: {
      id: 'theme',
      label: 'Theme',
      description: 'Change wallet appearance',
      icon: 'mdi:palette',
      systemIcon: 'paintpalette',
      testID: 'wallet-theme',
      onPress: handleTheme,
    },
    history: {
      id: 'history',
      label: 'History',
      description: 'Every payment in and out',
      icon: 'mdi:history',
      systemIcon: 'clock.arrow.circlepath',
      testID: 'wallet-history',
      onPress: handleHistory,
    },
    map: {
      id: 'map',
      label: 'Near me',
      menuText: 'Bitcoin near me',
      description: 'Places that accept Bitcoin',
      icon: 'mdi:map-marker-radius',
      systemIcon: 'mappin.and.ellipse',
      testID: 'wallet-map',
      onPress: handleMap,
    },
  };

  const renderBalance = (floorScale: number) => (
    <LayoutShiftProbe tag="account-carousel">
      <Account minHeight={minBalanceHeight * floorScale} />
    </LayoutShiftProbe>
  );

  // Keep BootEntrance and the wallet body mounted across the search toggle so
  // the splash→QR morph never replays and closing search restores this screen.
  return (
    <BootEntrance>
      <LayoutDebugWrapper
        onContentSizeChange={onContentSizeChange}
        refreshControl={pullToAi.refreshControl}
        scrollY={walletScrollY}
        contentContainerStyle={styles.scrollContent}>
        <Log name="WalletScreen" style={styles.screen}>
          <E2EReadyProofProbe />
          <E2EHerouiMenuProbe />
          <E2EToastProbe />
          <WalletSelectedMintProbe />
          <WalletWallpaperProbe />
          <ScrollableGradientOverlay contentHeight={contentHeight} />

          <View style={styles.topArea}>
            <HomeTop actions={actions} renderBalance={renderBalance} paymentsLocked={isSwapping} />
          </View>

          <View
            style={[
              styles.content,
              { gap: style.space.group, paddingHorizontal: style.space.gutter },
            ]}>
            {hasFeature('ecashMessages') ? <MessageEcashToReview /> : null}
            <LayoutShiftProbe tag="transactions">
              <Transactions
                account={ALL_UNITS_ACCOUNT}
                showMore={true}
                history={history}
                hideExpired={true}
                onVisiblePendingEcashChange={
                  __DEV__
                    ? (entries) =>
                        walletLog.info('wallet.layout.pending_visible', { count: entries.length })
                    : undefined
                }
              />
            </LayoutShiftProbe>
            {/* A month of nothing is two empty charts. They appear with the
                first payment. */}
            {history.length > 0 ? (
              <>
                <LayoutShiftProbe tag="spent-this-month">
                  <SpentThisMonth history={history} unit={account.unit} />
                </LayoutShiftProbe>
                <LayoutShiftProbe tag="received-this-month">
                  <ReceivedThisMonth history={history} unit={account.unit} />
                </LayoutShiftProbe>
              </>
            ) : null}
            <BitcoinNearYou />
          </View>
        </Log>
      </LayoutDebugWrapper>
      {/* No `topInset`: the overlay reads the navigator header height itself. */}
      <SearchOverlay recentContext="wallet" />
    </BootEntrance>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    padding: 0,
  },
  screen: {
    flexGrow: 1,
  },
  topArea: {
    paddingTop: WALLET_HEADER_TO_BALANCE_GAP,
  },
  content: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 2,
  },
});
