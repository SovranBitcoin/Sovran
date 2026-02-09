import { useHistoryWithMelts } from 'hooks/coco/useHistoryWithMelts';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { DebugBalancePanel } from 'components/blocks/DebugBalancePanel';
import { BitcoinNearYou } from 'components/blocks/BitcoinNearYou';
import { ReceivedThisMonth, SpentThisMonth } from 'components/blocks/MonthlyChart';
import { Transactions } from 'components/blocks/Transactions';
import { ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { View } from 'components/ui/View/View';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { LayoutDebugWrapper } from '../example';
import { useSettingsStore } from 'stores/settingsStore';

function TabOneScreen() {
  // Register this tab's background configuration - animates on focus
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const devMode = useSettingsStore((state) => state.experimental);
  const supportedUnits = useMemo(() => ['sat', 'usd', 'eur', 'gbp'], []);

  const accounts = useMemo(
    () =>
      [
        {
          unit: 'sat',
        },
        // {
        //   unit: 'usd',
        // },
        // {
        //   unit: 'eur',
        // },
        // {
        //   unit: 'gbp',
        // },
      ].filter((u) => supportedUnits.includes(u.unit)),
    [supportedUnits]
  );

  const [account, setAccount] = useState(accounts[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const onRefresh = useCallback(async () => {}, []);

  const { history } = useHistoryWithMelts();

  useDeeplink();
  useVersionCheck();

  return (
    <LayoutDebugWrapper
      onContentSizeChange={onContentSizeChange}
      refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}
      contentContainerStyle={{ padding: 0 }}>
      {/* Scrollable gradient overlay - must be first child */}
      <ScrollableGradientOverlay contentHeight={contentHeight} />

      <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
      {devMode ? <DebugBalancePanel /> : null}

      <View
        className="p-4 pb-24 pt-4"
        style={{
          // Account for the AccountPagerView height (50% of screen) plus button area (~88px)
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
