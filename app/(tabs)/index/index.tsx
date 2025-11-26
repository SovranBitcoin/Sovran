import { usePaginatedHistory } from 'coco-cashu-react';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { Transactions } from 'components/blocks/Transactions';
import AnimatedSpriteBackground from 'components/ui/SpriteView';
import { View } from 'components/ui/View';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { useTheme } from 'providers/ThemeProvider';
import { memo, useCallback, useMemo, useState } from 'react';
import { Dimensions, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import 'react-native-get-random-values';
import 'shim';

function TabOneScreen() {
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

  const onRefresh = useCallback(async () => {}, []);

  const { getPrimaryColor } = useTheme();
  const primaryColor900 = useMemo(() => getPrimaryColor('900'), [getPrimaryColor]);

  const { history } = usePaginatedHistory();

  useDeeplink();
  useVersionCheck();

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
      }}>
      <AnimatedSpriteBackground backgroundColor={primaryColor900} />

      <View className="flex-1">
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
          <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
          <View
            className="p-4 pt-0"
            style={{
              backgroundColor: opacity(primaryColor900, 0.99),
              minHeight: Dimensions.get('window').height - 375,
            }}>
            <LinearGradient
              colors={[
                opacity(primaryColor900, 0.99),
                opacity(primaryColor900, 0.5),
                opacity(primaryColor900, 0),
              ]}
              start={{ x: 0.5, y: 1 }}
              end={{ x: 0.5, y: 0 }}
              style={[StyleSheet.absoluteFill, { zIndex: -1, top: -250, height: 250 }]}
            />
            <Transactions account={account} showMore={true} history={history} hideExpired={true} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export default memo(TabOneScreen);
