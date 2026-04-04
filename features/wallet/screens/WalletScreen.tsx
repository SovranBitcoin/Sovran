import { useCallback, useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useHistoryWithMelts,
  ReceivedThisMonth,
  SpentThisMonth,
  Transactions,
} from '@/features/transactions';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { AccountPagerView } from '@/features/wallet/components/AccountPagerView';
import { BitcoinNearYou } from '@/features/wallet/components/BitcoinNearYou';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { View } from '@/shared/ui/primitives/View/View';
import { isAndroidLiquidHeaderSupported } from '@/navigation/nativeTabs';
import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { Screen, useLifecycleLogger } from '@/shared/lib/logger';

const ACCOUNTS = [{ unit: 'sat' }];

export function WalletScreen() {
  useLifecycleLogger('WalletScreen');
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const androidHeaderPadding = isAndroidLiquidHeaderSupported()
    ? insets.top + HEADER_LAYOUT.ANDROID_OVERLAY_OFFSET + HEADER_LAYOUT.ANDROID_BUTTON_SIZE
    : 0;

  const [account, setAccount] = useState(ACCOUNTS[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const { history, refresh } = useHistoryWithMelts();
  useVersionCheck();

  return (
    <LayoutDebugWrapper
      onContentSizeChange={onContentSizeChange}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      contentContainerStyle={{ padding: 0, paddingTop: androidHeaderPadding }}>
      <Screen name="WalletScreen">
        <ScrollableGradientOverlay contentHeight={contentHeight} />

        <AccountPagerView accounts={ACCOUNTS} setAccount={setAccount} account={account} />

        <View
          className="p-4 pb-24 pt-4"
          style={{
            minHeight: windowHeight - windowHeight * 0.5 - 88,
            gap: 16,
          }}>
          <Transactions account={account} showMore={true} history={history} hideExpired={true} />
          <SpentThisMonth history={history} unit={account.unit} />
          <ReceivedThisMonth history={history} unit={account.unit} />
          <BitcoinNearYou />
        </View>
      </Screen>
    </LayoutDebugWrapper>
  );
}
