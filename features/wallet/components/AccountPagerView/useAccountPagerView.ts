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
  const pagerHeight = Math.max(windowHeight * 0.3, 250);

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
