import { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useHandleCameraPermission } from '@/features/camera';
import { usePaymentFlowMachine } from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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
  foreground: string;
  shadeColor100: string;
  shadeColor300: string;
}

export function useAccountPagerView({
  accounts,
  setAccount,
  account,
}: AccountPagerViewProps): AccountPagerViewShared {
  const { height: windowHeight } = useWindowDimensions();
  const [foreground, shadeColor100, shadeColor300] = useThemeColor([
    'foreground',
    'shade-100',
    'shade-300',
  ] as const);

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
    router.navigate({
      pathname: '/(receive-flow)/receive',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [account.unit]);

  const handleScanQR = useCallback(async () => {
    const granted = await handlePermission();
    if (!granted) return;
    router.navigate({
      pathname: '/camera',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [handlePermission, account.unit]);

  const handleSend = useCallback(async () => {
    await machine.startSendEcash();
  }, [machine]);

  return {
    accounts,
    account,
    pagerHeight,
    swiperRef,
    onPageSelected,
    handleReceive,
    handleScanQR,
    handleSend,
    foreground,
    shadeColor100,
    shadeColor300,
  };
}
