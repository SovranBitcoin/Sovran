import { useHistoryWithMelts } from 'hooks/coco/useHistoryWithMelts';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { DevPopupPanel } from 'components/blocks/DevPopupPanel';
import { BitcoinNearYou } from 'components/blocks/BitcoinNearYou';
import { ReceivedThisMonth, SpentThisMonth } from 'components/blocks/MonthlyChart';
import { Transactions } from 'components/blocks/Transactions';
import { ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { View } from 'components/ui/View/View';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { memo, useCallback, useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { LayoutDebugWrapper } from '@/app/(drawer)/(tabs)/example';
import { useSettingsStore } from 'stores/settingsStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAndroidLiquidHeaderSupported } from '@/components/navigation/expoRouter55';
import { HEADER_LAYOUT } from '@/constants/wallet-header';

const ACCOUNTS = [{ unit: 'sat' }];

function TabOneScreen() {
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const devMode = useSettingsStore((state) => state.experimental);

  const androidHeaderPadding = isAndroidLiquidHeaderSupported()
    ? insets.top + HEADER_LAYOUT.ANDROID_OVERLAY_OFFSET + HEADER_LAYOUT.ANDROID_BUTTON_SIZE
    : 0;

  const [account, setAccount] = useState(ACCOUNTS[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const { history, refresh } = useHistoryWithMelts();
  useDeeplink();
  useVersionCheck();

  return (
    <LayoutDebugWrapper
      onContentSizeChange={onContentSizeChange}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      contentContainerStyle={{ padding: 0, paddingTop: androidHeaderPadding }}>
      <ScrollableGradientOverlay contentHeight={contentHeight} />

      <AccountPagerView accounts={ACCOUNTS} setAccount={setAccount} account={account} />

      {devMode ? <DevPopupPanel /> : null}

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
    </LayoutDebugWrapper>
  );
}

export default memo(TabOneScreen);
