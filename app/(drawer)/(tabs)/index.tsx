import 'helper/global';
import React, { memo, useCallback, useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import 'react-native-get-random-values';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { View, VStack } from 'components/ui/View';
import { Transactions } from 'components/blocks/Transactions';
import { useTransactions } from 'providers/CocoTransactionsProvider';
import { memoizedGetSettings, memoizedGetTheme, termsAccepted } from 'helper/redux/settings';
import { getStructure, store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import { OnboardingLayout } from 'app/onboard/OnboardLayout';
import { SovranTextIcon } from 'assets/icons';
import { Text } from 'components/ui/Text';
import TermsConditionsScreen from 'app/settings-pages/terms';
import { router } from 'expo-router';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import AnimatedSpriteBackground from 'components/ui/SpriteView';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { useDeeplink } from 'hooks/useDeeplink';
import { getLatestVersion } from 'helper/apiClient';
import semver from 'semver';
import { version } from 'app/settings-pages';

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

  const theme = useSelector(memoizedGetTheme);

  const { history } = useTransactions();

  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const settings = useSelector(memoizedGetSettings);

  // Note: Header options are now handled by the layout file in Expo Router

  useDeeplink();

  useEffect(() => {
    (async () => {
      if (!version) return;

      const latestVersionResult = await getLatestVersion({
        storage: {
          version: version,
          store: getStructure(store.getState()),
        },
      });

      if (latestVersionResult.isOk()) {
        if (
          latestVersionResult.value &&
          typeof latestVersionResult.value === 'object' &&
          'version' in latestVersionResult.value
        ) {
          if (semver.gt(latestVersionResult.value.version, version)) {
            showMessage('latest_version', {
              version: latestVersionResult.value.version,
            });
          }
        }
      }
    })();
  }, []);

  if (!settings?.termsAccepted) {
    return (
      <TermsConditionsScreen
        onClose={() => {
          store.dispatch(termsAccepted(new Date().toISOString()));
        }}
      />
    );
  }

  if (!currentProfile?.pubkey) {
    return (
      <OnboardingLayout
        nextScreen="onboard/ecash"
        actions={[
          {
            text: 'Next',
            icon: 'fa6-solid:chevron-right',
            variant: 'primary',
            onPress: async () => router.push('/onboard/ecash'),
          },
        ]}>
        <VStack align="center" justify="center" flex={1} spacing={4}>
          <Text size={32} weight="heavy">
            Welcome to
          </Text>
          <SovranTextIcon size={200} />
        </VStack>
      </OnboardingLayout>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
      }}>
      <AnimatedSpriteBackground backgroundColor={theme.greys[950]} />

      <View className="flex-1">
        <ScrollView
          className="flex-1"
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}>
          <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
          <View
            className="p-4 pt-0"
            style={{
              backgroundColor: opacity(theme.greys[950], 0.99),
            }}>
            {theme.shades && (
              <LinearGradient
                colors={[
                  opacity(theme.greys[950], 0.99),
                  opacity(theme.greys[950], 0.5),
                  opacity(theme.greys[950], 0),
                ]}
                start={{ x: 0.5, y: 1 }}
                end={{ x: 0.5, y: 0 }}
                style={[StyleSheet.absoluteFill, { zIndex: -1, top: -250, height: 250 }]}
              />
            )}
            <Transactions account={account} showMore={true} history={history} hideExpired={true} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export default memo(TabOneScreen);
