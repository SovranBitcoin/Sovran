import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { Menu, type MenuTriggerRef } from 'heroui-native';
import { usePullToAiRefreshControl } from '@/shared/blocks/PullToAiRefreshControl';

import Icon from 'assets/icons';
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
import { zIndex } from '@/shared/styles/tokens';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { QRButton } from '@/shared/ui/composed/QRButton';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useHandleCameraPermission } from '@/features/camera';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useNfcSupported } from '@/shared/lib/nfc';
import { Log, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { useHeaderHeight } from '@react-navigation/elements';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { UnifiedSearch } from '@/shared/ui/composed/search/UnifiedSearch';

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

  // Inline header search (shared with Feed). While searching, the wallet body is
  // replaced by the people-search view — see the render branch below.
  const { isSearching } = useSearchContext();
  const headerHeight = useHeaderHeight();
  const surface = useThemeColor('surface');

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
  const handlePullToAiRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const pullToAi = usePullToAiRefreshControl({ onRefresh: handlePullToAiRefresh });
  useVersionCheck();

  const { handlePermission } = useHandleCameraPermission();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: ACCOUNT.unit });
  const moreMenuTriggerRef = useRef<MenuTriggerRef>(null);
  const openMoreMenu = useCallback(() => {
    setTimeout(() => moreMenuTriggerRef.current?.open(), 0);
  }, []);

  // While a multi-leg swap is running, every payment-initiating button on
  // this screen is gated. Coco's mint/melt services serialize through a
  // per-instance lock, and the user kicking off a Send/Receive/Swap/Split
  // Bill in parallel can stall the swap or surface "operation already in
  // progress" errors. Greying out is the cheapest user-visible indicator.
  const isSwapping = useSwapStatusStore((s) => s.active?.state === 'running');

  const handleReceive = useCallback(() => {
    walletLog.info('wallet.action.receive', { unit: ACCOUNT.unit });
    clearPaymentContext('wallet.receive');
    void machine.startReceive({ reset: true });
  }, [machine]);

  const handleScanQR = useCallback(async () => {
    walletLog.info('wallet.action.scan_qr', { unit: ACCOUNT.unit });
    const granted = await handlePermission();
    if (!granted) {
      walletLog.info('wallet.action.scan_qr_denied');
      return;
    }
    clearPaymentContext('wallet.scan_qr');
    router.navigate({
      pathname: '/camera',
      params: { to: 'sendToken', unit: ACCOUNT.unit },
    });
  }, [handlePermission]);

  const handleSend = useCallback(async () => {
    walletLog.info('wallet.action.send', { unit: ACCOUNT.unit });
    clearPaymentContext('wallet.send');
    await machine.startSendEcash({ reset: true });
  }, [machine]);

  const handleTheme = useCallback(() => {
    walletLog.info('wallet.theme.tap');
    router.push('/(theme-flow)/preview');
  }, []);

  const handleNearPay = useCallback(() => {
    walletLog.info('wallet.near_pay.tap', { unit: ACCOUNT.unit });
    clearPaymentContext('wallet.near_pay');
    router.push('/(send-flow)/nearPay');
  }, []);

  const nfcSupported = useNfcSupported();
  const handleNfc = useCallback(() => {
    walletLog.info('wallet.action.nfc', { unit: ACCOUNT.unit });
    clearPaymentContext('wallet.nfc');
    void machine.scan?.(undefined, { source: 'nfc' });
  }, [machine]);

  // Keep BootEntrance mounted across the search toggle so the splash→QR morph
  // never replays; swap only the inner body. The transparent wallet header means
  // the search view must paint its own surface and inset below the header.
  if (isSearching) {
    return (
      <BootEntrance>
        <View
          style={[styles.searchContainer, { backgroundColor: surface, paddingTop: headerHeight }]}>
          <UnifiedSearch recentContext="wallet" />
        </View>
      </BootEntrance>
    );
  }

  return (
    <BootEntrance>
      <LayoutDebugWrapper
        onContentSizeChange={onContentSizeChange}
        refreshControl={pullToAi.refreshControl}
        contentContainerStyle={styles.scrollContent}>
        <Log name="WalletScreen" style={styles.screen}>
          <ScrollableGradientOverlay contentHeight={contentHeight} />

          <View style={styles.topArea}>
            <Account account={ACCOUNT} pagerHeight={pagerHeight} />

            <HStack justify="space-around" style={styles.secondaryActions}>
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
              {nfcSupported ? (
                <CircleActionButton
                  icon="lucide:nfc"
                  systemIcon="wave.3.right"
                  label="NFC"
                  testID="wallet-nfc"
                  disabled={isSwapping}
                  onPress={handleNfc}
                />
              ) : null}
              <Menu presentation="bottom-sheet">
                <Menu.Trigger
                  ref={moreMenuTriggerRef}
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
                  <View style={{ width: 1, height: 1 }} />
                </Menu.Trigger>
                <CircleActionButton
                  icon="tabler:dots"
                  systemIcon="ellipsis"
                  label="More"
                  testID="wallet-more"
                  onPress={openMoreMenu}
                />
                <Menu.Portal disableFullWindowOverlay={Platform.OS === 'android'}>
                  <MenuScrim />
                  <Menu.Content presentation="bottom-sheet">
                    <Menu.Label className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
                      Select option
                    </Menu.Label>
                    <Menu.Item testID="wallet-action-theme" onPress={handleTheme}>
                      <HStack align="center" gap={10} style={{ flex: 1 }}>
                        <Icon name="mdi:palette" size={20} />
                        <View style={{ flex: 1 }}>
                          <Menu.ItemTitle>Theme</Menu.ItemTitle>
                          <Menu.ItemDescription>Change wallet appearance</Menu.ItemDescription>
                        </View>
                      </HStack>
                    </Menu.Item>
                    <Menu.Item
                      testID="wallet-action-near-pay"
                      isDisabled={isSwapping}
                      onPress={handleNearPay}>
                      <HStack align="center" gap={10} style={{ flex: 1 }}>
                        <Icon name="mdi:bluetooth" size={20} />
                        <View style={{ flex: 1 }}>
                          <Menu.ItemTitle>Nut Drop</Menu.ItemTitle>
                          <Menu.ItemDescription>Pay a nearby BitChat user</Menu.ItemDescription>
                        </View>
                      </HStack>
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
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
  searchContainer: {
    flex: 1,
  },
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
    zIndex: zIndex.modal,
  },
  content: {
    gap: 16,
    paddingBottom: 96,
    paddingHorizontal: 16,
    paddingTop: 2,
  },
});
