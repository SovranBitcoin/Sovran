import { useCallback, useState } from 'react';
import { Platform, RefreshControl, StyleSheet, useWindowDimensions } from 'react-native';

import {
  useHistoryWithMelts,
  ReceivedThisMonth,
  SpentThisMonth,
  Transactions,
} from '@/features/transactions';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { Account } from '@/features/wallet/components/Account';
import { BitcoinNearYou } from '@/features/wallet/components/BitcoinNearYou';
import { BootEntrance } from '@/shared/ui/composed/BootEntrance';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHandleCameraPermission } from '@/features/camera';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { Log, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';

const ACCOUNT = { unit: 'sat' } as const;

const QR_BUTTON_SIZE = 64;
const CAPSULE_BUTTON_HEIGHT = 48;
const PRIMARY_ACTION_ROW_HEIGHT = Math.max(QR_BUTTON_SIZE, CAPSULE_BUTTON_HEIGHT);
// Locked heights for the rows below Account. Without these, the splash → QR
// morph alignment drifts: SwiftUI Host children inside CircleActionButtons
// take a frame or two to settle their intrinsic size, and the CapsuleButtons
// can grow as their labels lay out, shifting the QR's Y on first paint.
// Value: circle (52) + label margin-top (6) + label line height (~18).
const SECONDARY_ACTION_ROW_HEIGHT = 76;
const WALLET_TOP_SECTION_GAP = 18;
const WALLET_HEADER_TO_BALANCE_GAP = 24;

const RECEIVE_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.down.left' : undefined;
const SEND_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.up.right' : undefined;

export function WalletScreen() {
  useLifecycleLogger('WalletScreen');
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  // Deterministic header height — locked so the QR button below it lands at
  // a stable Y on first paint. The boot-splash → QR morph reads the button's
  // window position once layout settles; a flex-driven height would shift as
  // history/transactions data loads beneath the topArea, breaking alignment.
  const pagerHeight = Math.max(windowHeight * 0.22, 200);

  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const { history, refresh } = useHistoryWithMelts();
  useVersionCheck();

  const { handlePermission } = useHandleCameraPermission();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: ACCOUNT.unit });

  // While a multi-leg swap is running, every payment-initiating button on
  // this screen is gated. Coco's mint/melt services serialize through a
  // per-instance lock, and the user kicking off a Send/Receive/Swap/Split
  // Bill in parallel can stall the swap or surface "operation already in
  // progress" errors. Greying out is the cheapest user-visible indicator.
  const isSwapping = useSwapStatusStore((s) => s.active?.state === 'running');

  const handleReceive = useCallback(() => {
    walletLog.info('wallet.action.receive', { unit: ACCOUNT.unit });
    void machine.startReceive({ reset: true });
  }, [machine]);

  const handleScanQR = useCallback(async () => {
    walletLog.info('wallet.action.scan_qr', { unit: ACCOUNT.unit });
    const granted = await handlePermission();
    if (!granted) {
      walletLog.info('wallet.action.scan_qr_denied');
      return;
    }
    router.navigate({
      pathname: '/camera',
      params: { to: 'sendToken', unit: ACCOUNT.unit },
    });
  }, [handlePermission]);

  const handleSend = useCallback(async () => {
    walletLog.info('wallet.action.send', { unit: ACCOUNT.unit });
    await machine.startSendEcash({ reset: true });
  }, [machine]);

  return (
    <BootEntrance>
      <LayoutDebugWrapper
        onContentSizeChange={onContentSizeChange}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
        contentContainerStyle={styles.scrollContent}>
        <Log name="WalletScreen" style={styles.screen}>
          <ScrollableGradientOverlay contentHeight={contentHeight} />

          <View style={styles.topArea}>
            <Account account={ACCOUNT} pagerHeight={pagerHeight} />

            <HStack justify="space-around" style={styles.secondaryActions}>
              <CircleActionButton
                icon="mdi:silverware-fork-knife"
                systemIcon="fork.knife"
                label="Split Bill"
                testID="wallet-split-bill"
                disabled={isSwapping}
                onPress={() => {
                  walletLog.info('wallet.split_bill.tap');
                  router.push('/(split-bill-flow)/amount');
                }}
              />
              <CircleActionButton
                icon="mdi:swap-horizontal"
                systemIcon="arrow.left.arrow.right"
                label="Swap"
                testID="wallet-swap"
                disabled={isSwapping}
                onPress={() => {
                  walletLog.info('wallet.swap.tap', { unit: ACCOUNT.unit });
                  router.navigate({
                    pathname: '/(mint-flow)/distribution',
                    params: { unit: ACCOUNT.unit },
                  });
                }}
              />
              <CircleActionButton
                icon="mdi:palette"
                systemIcon="paintpalette"
                label="Theme"
                testID="wallet-action-theme"
                onPress={() => {
                  walletLog.info('wallet.theme.tap');
                  router.push('/(theme-flow)/preview');
                }}
              />
            </HStack>

            {/* Wrap the Receive / Send / QR row in a single pointerEvents=none
                shroud while swapping. CapsuleButton and QRButton don't accept a
                `disabled` prop, so the cheapest correct gate is to short-circuit
                touches at the parent and reduce opacity to match
                CircleActionButton's disabled treatment (0.4). */}
            <View
              pointerEvents={isSwapping ? 'none' : 'auto'}
              style={[styles.primaryActions, { opacity: isSwapping ? 0.4 : 1 }]}>
              <View style={styles.capsuleRow}>
                <View testID="wallet-receive" style={styles.capsuleSlot}>
                  <CapsuleButton
                    label="Receive"
                    icon="lucide:arrow-down-left"
                    systemIcon={RECEIVE_SYSTEM_ICON}
                    roundedSide="left"
                    onPress={handleReceive}
                  />
                </View>
                <View testID="wallet-send" style={styles.capsuleSlot}>
                  <CapsuleButton
                    label="Send"
                    icon="lucide:arrow-up-right"
                    systemIcon={SEND_SYSTEM_ICON}
                    roundedSide="right"
                    onPress={handleSend}
                  />
                </View>
              </View>

              <View pointerEvents="box-none" style={styles.qrAnchor}>
                <QRButton onPress={handleScanQR} size={QR_BUTTON_SIZE} />
              </View>
            </View>
          </View>

          <View style={styles.content}>
            <Transactions account={ACCOUNT} showMore={true} history={history} hideExpired={true} />
            <SpentThisMonth history={history} unit={ACCOUNT.unit} />
            <ReceivedThisMonth history={history} unit={ACCOUNT.unit} />
            <BitcoinNearYou />
          </View>
        </Log>
      </LayoutDebugWrapper>
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
    gap: WALLET_TOP_SECTION_GAP,
    paddingBottom: 16,
    paddingTop: WALLET_HEADER_TO_BALANCE_GAP,
  },
  secondaryActions: {
    alignItems: 'flex-start',
    height: SECONDARY_ACTION_ROW_HEIGHT,
    paddingHorizontal: 32,
  },
  primaryActions: {
    height: PRIMARY_ACTION_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 12,
    position: 'relative',
    width: '100%',
  },
  capsuleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  capsuleSlot: {
    flex: 1,
  },
  qrAnchor: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  content: {
    gap: 16,
    paddingBottom: 96,
    paddingHorizontal: 16,
    paddingTop: 2,
  },
});
