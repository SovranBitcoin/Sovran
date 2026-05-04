import { useCallback, useState } from 'react';
import { Platform, RefreshControl, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { isAndroidLiquidHeaderSupported } from '@/navigation/nativeTabs';
import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHandleCameraPermission } from '@/features/camera';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { Log, useLifecycleLogger, walletLog } from '@/shared/lib/logger';

const ACCOUNT = { unit: 'sat' } as const;

const BUTTON_H = 48;
const QR_SIZE = 72;
// Lock the secondary action row height so the QR button below it lands at a
// deterministic Y on first paint. Without this, the SwiftUI Host children
// inside CircleActionButtons take a frame or two to settle their intrinsic
// size, shifting the QR button down and breaking the boot-splash → QR morph
// alignment. Value: circle (52) + label margin-top (6) + label line height (~18).
const SECONDARY_ACTION_ROW_HEIGHT = 76;

const RECEIVE_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.down.left' : undefined;
const SEND_SYSTEM_ICON = Platform.OS === 'ios' ? 'arrow.up.right' : undefined;

export function WalletScreen() {
  useLifecycleLogger('WalletScreen');
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const androidHeaderPadding = isAndroidLiquidHeaderSupported()
    ? insets.top + HEADER_LAYOUT.ANDROID_OVERLAY_OFFSET + HEADER_LAYOUT.ANDROID_BUTTON_SIZE
    : 0;

  // Tighter than the original 0.30/250 — trims the vertical dead space
  // between the header and the secondary action row while still leaving
  // enough headroom for the primary balance.
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
        contentContainerStyle={{ padding: 0, paddingTop: androidHeaderPadding }}>
        <Log name="WalletScreen">
          <ScrollableGradientOverlay contentHeight={contentHeight} />

          <View className="w-full" style={{ height: pagerHeight }}>
            <Account account={ACCOUNT} pagerHeight={pagerHeight} />
          </View>

          {/*
           * Secondary action row — sits above the primary Receive/QR/Send capsule row.
           * Hosts [Split Bill] [Swap] [Theme]. The Swap action navigates to the
           * mint-flow `distribution` screen, whose title is "Balance split".
           */}
          <HStack
            justify="space-around"
            style={{ marginTop: 4, paddingHorizontal: 32, height: SECONDARY_ACTION_ROW_HEIGHT }}>
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
            className="relative w-full justify-center px-3"
            style={{
              marginTop: 8,
              height: Math.max(QR_SIZE, BUTTON_H),
              opacity: isSwapping ? 0.4 : 1,
            }}>
            <View className="flex-row gap-3">
              <View testID="wallet-receive" className="flex-1">
                <CapsuleButton
                  label="Receive"
                  icon="lucide:arrow-down-left"
                  systemIcon={RECEIVE_SYSTEM_ICON}
                  onPress={handleReceive}
                />
              </View>
              <View testID="wallet-send" className="flex-1">
                <CapsuleButton
                  label="Send"
                  icon="lucide:arrow-up-right"
                  systemIcon={SEND_SYSTEM_ICON}
                  onPress={handleSend}
                />
              </View>
            </View>

            <View pointerEvents="box-none" className="absolute inset-x-0 z-[1000] items-center">
              <QRButton onPress={handleScanQR} />
            </View>
          </View>

          <View
            className="p-4 pb-24 pt-4"
            style={{
              minHeight: windowHeight - windowHeight * 0.5 - 88,
              gap: 16,
            }}>
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
