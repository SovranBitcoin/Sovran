import { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useHandleCameraPermission } from '@/features/camera';
import { useMintManagement } from '@/features/mint';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
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
  const { getBalances } = useMintManagement();

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintUrl = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

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
    let balance = 0;
    try {
      const balances = await getBalances();
      balance = balances[selectedMintUrl || ''] || 0;
    } catch (error) {
      if (__DEV__) console.error('Failed to get balance:', error);
    }

    if (balance <= 0) {
      router.navigate({
        pathname: '/(send-flow)/mintSelect',
        params: { to: 'sendToken', unit: account.unit },
      });
      return;
    }

    router.navigate({
      pathname: '/(send-flow)/currency',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [getBalances, selectedMintUrl, account.unit]);

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
