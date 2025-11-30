import { usePaginatedHistory } from 'coco-cashu-react';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { Transactions } from 'components/blocks/Transactions';
import { AnimatedBackgroundView, ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { View } from 'components/ui/View';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { memo, useCallback, useMemo, useState } from 'react';
import { Dimensions, RefreshControl, ScrollView } from 'react-native';
import 'react-native-get-random-values';
import 'shim';

function TabOneScreen() {
  // Register this tab's background configuration - animates on focus
  useBackgroundConfig({ blurMode: 'partial' });

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

  const { history } = usePaginatedHistory();

  useDeeplink();
  useVersionCheck();

  return (
    <AnimatedBackgroundView>
      <View className="flex-1">
        <ScrollView
          style={{ flex: 1 }}
          onContentSizeChange={onContentSizeChange}
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
          {/* Scrollable gradient overlay - must be first child inside ScrollView */}
          <ScrollableGradientOverlay contentHeight={contentHeight} />

          <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
          <View
            className="p-4 pt-0"
            style={{
              minHeight: Dimensions.get('window').height - 375,
            }}>
            <Transactions account={account} showMore={true} history={history} hideExpired={true} />
          </View>
        </ScrollView>
      </View>
    </AnimatedBackgroundView>
  );
}

export default memo(TabOneScreen);
