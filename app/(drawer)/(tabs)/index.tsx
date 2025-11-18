import 'shim';
import React, { memo, useCallback, useState } from 'react';
import 'react-native-get-random-values';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { View } from 'components/ui/View';
import { Transactions } from 'components/blocks/Transactions';
import { useTheme } from 'providers/ThemeProvider';
import AnimatedSpriteBackground from 'components/ui/SpriteView';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { usePaginatedHistory } from 'coco-cashu-react';
import { AnimatedText } from 'components/ui/AnimatedText';

function TabOneScreen() {
  const supportedUnits = ['sat', 'usd', 'eur', 'gbp'];

  const accounts = [
    {
      unit: 'sat',
    },
    {
      unit: 'usd',
    },
    {
      unit: 'eur',
    },
    {
      unit: 'gbp',
    },
  ].filter((u) => supportedUnits.includes(u.unit));

  const [account, setAccount] = useState(accounts[0]);

  const onRefresh = useCallback(async () => {}, []);

  const { getPrimaryColor } = useTheme();

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
      <AnimatedSpriteBackground backgroundColor={getPrimaryColor('900')} />

      <View className="flex-1">
        <ScrollView
          className="flex-1"
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
          <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
          <View
            className="p-4 pt-0"
            style={{ backgroundColor: opacity(getPrimaryColor('900'), 0.99) }}>
            <LinearGradient
              colors={[
                opacity(getPrimaryColor('900'), 0.99),
                opacity(getPrimaryColor('900'), 0.5),
                opacity(getPrimaryColor('900'), 0),
              ]}
              start={{ x: 0.5, y: 1 }}
              end={{ x: 0.5, y: 0 }}
              style={[StyleSheet.absoluteFill, { zIndex: -1, top: -250, height: 250 }]}
            />
            <AnimatedText loading={false} capHeight={24} bold>
              Hello
            </AnimatedText>
            <AnimatedText loading={true} capHeight={24} bold>
              Hello
            </AnimatedText>
            <Transactions account={account} showMore={true} history={history} hideExpired={true} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export default memo(TabOneScreen);
