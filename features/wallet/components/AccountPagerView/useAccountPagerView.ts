import { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useHandleCameraPermission } from '@/features/camera';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { log } from '@/shared/lib/logger';

export const BUTTON_H = 48;
export const QR_SIZE = 72;
// Lock the secondary action row height so the QR button below it lands at a
// deterministic Y on first paint. Without this, the SwiftUI Host children
// inside CircleActionButtons take a frame or two to settle their intrinsic
// size, shifting the QR button down and breaking the boot-splash → QR morph
// alignment. Value: circle (52) + label margin-top (6) + label line height (~18).
export const SECONDARY_ACTION_ROW_HEIGHT = 76;

export interface AccountType {
  unit: string;
}

export interface AccountPagerViewProps {
  accounts: AccountType[];
  setAccount: (account: AccountType) => void;
  account: AccountType;
}

export interface AccountPagerViewShared {
  accounts: AccountType[];
  account: AccountType;
  pagerHeight: number;
  swiperRef: React.RefObject<any>;
  onPageSelected: (index: number) => Promise<void>;
  handleReceive: () => void;
  handleScanQR: () => Promise<void>;
  handleSend: () => Promise<void>;
}

export function useAccountPagerView({
  accounts,
  setAccount,
  account,
}: AccountPagerViewProps): AccountPagerViewShared {
  const { height: windowHeight } = useWindowDimensions();
  // Tighter than the original 0.30/250 — trims the vertical dead space
  // between the header and the secondary action row while still leaving
  // enough headroom for the primary balance + account dots.
  const pagerHeight = Math.max(windowHeight * 0.22, 200);

  const { handlePermission } = useHandleCameraPermission();
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: account.unit });

  const swiperRef = useRef<any>(null);

  const onPageSelected = useCallback(
    async (index: number): Promise<void> => {
      setAccount(accounts[index]);
      await EnhancedHaptics.successHaptic();
    },
    [accounts, setAccount]
  );

  useEffect(() => {
    const idx = accounts.findIndex((a) => a.unit === account.unit);
    swiperRef.current?.goTo(idx);
  }, [accounts, account]);

  const handleReceive = useCallback(() => {
    log.info('wallet.action.receive', { unit: account.unit });
    void machine.startReceive({ reset: true });
  }, [machine, account.unit]);

  const handleScanQR = useCallback(async () => {
    log.info('wallet.action.scan_qr', { unit: account.unit });
    const granted = await handlePermission();
    if (!granted) {
      log.info('wallet.action.scan_qr_denied');
      return;
    }
    router.navigate({
      pathname: '/camera',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [handlePermission, account.unit]);

  const handleSend = useCallback(async () => {
    log.info('wallet.action.send', { unit: account.unit });
    await machine.startSendEcash({ reset: true });
  }, [machine, account.unit]);

  return {
    accounts,
    account,
    pagerHeight,
    swiperRef,
    onPageSelected,
    handleReceive,
    handleScanQR,
    handleSend,
  };
}
