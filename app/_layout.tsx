import 'global.css';

// Import core libraries
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Animated, Dimensions, StatusBar, LogBox, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { View } from 'components/common/View';

// Import third-party libraries
import 'intl';
import 'intl/locale-data/jsonp/en';
import 'react-native-gesture-handler';
import { PersistGate } from 'redux-persist/integration/react';
import { Provider, useSelector } from 'react-redux';
import * as SplashScreen from 'expo-splash-screen';
import { Easing } from 'react-native-reanimated';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import { SheetProvider } from 'react-native-actions-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// import * as Sentry from '@sentry/react-native';
import { NostrProvider } from 'nostr-react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { bytesToHex } from '@noble/hashes/utils';
import { nip04, nip19 } from 'nostr-tools';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// Import local components and utilities
import { persistor, store } from 'helper/redux/store';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { memoizedGetCurrentProfile, useNostr } from 'helper/redux/nostr';
import { getFollowedUsers } from './ProfilePage';
import ndk, { relays } from 'components/ndk';
import { MODAL_SCREENS, MODAL_SCREENS_ALT } from 'helper/navigation/screens';
import { TransactionProvider } from 'components/providers/TransactionsProvider';
import { WalletsProvider } from 'components/providers/WalletsProviders';
import { PricelistProvider } from 'components/providers/PricelistProvider';
import { registerAllSheets } from 'components/layout/sheets/registerSheets';
import PasscodeGate from 'components/passcode/PasscodeGate';
import { useFonts } from 'hooks/useFonts';

registerAllSheets({ context: 'global' });

// Configure constants
const RELAY_URLS = relays;

// Initialize global configurations
LogBox.ignoreAllLogs();
dayjs.extend(relativeTime);

// Initialize QueryClient
const queryClient = new QueryClient();

/**
 * Handles DM message fetching and decryption
 */
function useNostrDMs(currentProfile, addMessage, messages) {
  useEffect(() => {
    if (!currentProfile?.nsec) return;

    const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);
    const privKey = bytesToHex(privKeyBytes);
    const pubKey = currentProfile.pubkey;

    // Set up subscription for direct messages
    const fetchDMs = async () => {
      const filters = [{ kinds: [4], '#p': [pubKey] }];
      const subscription = ndk.subscribe(filters);

      subscription.on('event', async (event) => {
        try {
          // Skip if message already exists
          if (messages.some((msg) => msg.id === event.id)) return;

          const decryptedMessage = await nip04.decrypt(privKey, event.pubkey, event.content);

          addMessage(currentProfile.pubkey, {
            sender: event.pubkey,
            receiver: currentProfile.pubkey,
            content: decryptedMessage,
            created_at: event.created_at,
            id: event.id,
            sig: event.sig,
          });
        } catch {}
      });
    };

    fetchDMs();
  }, [currentProfile.pubkey, currentProfile.nsec, addMessage, messages]);
}

/**
 * Splash screen component
 */
function MySplashScreen({ opacity }: { opacity: Animated.Value }) {
  return (
    <Animated.View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        opacity,
      }}>
      <Animated.Image
        style={{
          width: Dimensions.get('window').width,
          height: Dimensions.get('window').height,
        }}
        source={require('assets/images/splash.png')}
      />
    </Animated.View>
  );
}

/**
 * Stack navigation component
 */
function MainStack() {
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const { addMessage, messages, setFollows } = useNostr();
  const theme = useSelector(memoizedGetTheme);

  // Load followed users
  useEffect(() => {
    const loadFollowedUsers = async () => {
      const followedUsers = await getFollowedUsers(currentProfile.pubkey);
      if (followedUsers.length) setFollows(followedUsers);
    };

    loadFollowedUsers();
  }, [currentProfile.pubkey, setFollows]);

  // Set up DM subscriptions
  useNostrDMs(currentProfile, addMessage, messages);

  // Screen options builder
  const getScreenOptions = (screenName, isModal = false) => {
    if (isModal) return screenName.options || {};

    return {
      headerShown: true,
      headerTitle: screenName.title,
      headerTitleStyle: {
        color: greys(theme)[0],
      },
      headerBlurEffect: 'regular',
      headerTransparent: true,
      headerBackTitle: 'Back',
      headerTintColor: greys(theme)[0],
      headerBackTitleStyle: {
        fontSize: 16,
      },
      headerStyle: {
        backgroundColor: currentProfile.pubkey ? greys(theme)[950] : 'transparent',
      },
      headerLargeStyle: {
        backgroundColor: currentProfile.pubkey ? greys(theme)[950] : 'transparent',
      },
      ...screenName.options,
    };
  };

  return (
    <>
      <StatusBar
        backgroundColor={greys(theme)[950]}
        barStyle={theme === 'light' ? 'dark-content' : 'light-content'}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />

        {/* Modal screens */}
        {MODAL_SCREENS.map(({ name, options }) => (
          <Stack.Screen options={options} key={name} name={name} />
        ))}

        {/* Regular screens with headers */}
        {MODAL_SCREENS_ALT.map((screenName) => (
          <Stack.Screen
            options={getScreenOptions(screenName)}
            key={screenName.name}
            name={screenName.name}
          />
        ))}
      </Stack>
    </>
  );
}

/**
 * Main application component
 */
export default function RootLayout() {
  const { init: initializeNDK } = useNDK();
  const [appIsReady, setAppIsReady] = useState(false);
  const scaleRef = useRef(new Animated.Value(1));

  // Load fonts
  const [fontsLoaded, fontsError] = useFonts();

  // Handle font loading errors
  useEffect(() => {
    if (fontsError) throw fontsError;
  }, [fontsError]);

  // Initialize NDK and prepare app
  useEffect(() => {
    if (fontsLoaded) {
      // Start splash screen fade out animation
      setTimeout(() => {
        Animated.timing(scaleRef.current, {
          toValue: 0,
          duration: 500,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(() => setAppIsReady(true));
      }, 0);
    }

    // Initialize Nostr Development Kit
    initializeNDK({
      explicitRelayUrls: RELAY_URLS,
    });
  }, [fontsLoaded, initializeNDK]);

  // Hide splash screen when app is ready
  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) await SplashScreen.hideAsync();
  }, [appIsReady]);

  // Show splash screen while loading
  if (!appIsReady) {
    return <MySplashScreen opacity={scaleRef.current} />;
  }

  // Get container styles based on platform
  const containerStyle = {
    width:
      Platform.OS === 'web'
        ? Math.min(Dimensions.get('window').width, 600)
        : Dimensions.get('window').width,
    margin: 'auto',
    maxWidth: '100%',
  };

  return (
    <SafeAreaProvider style={containerStyle}>
      <NostrProvider relayUrls={RELAY_URLS}>
        <PersistGate loading={null} persistor={persistor}>
          <Provider store={store}>
            <QueryClientProvider client={queryClient}>
              <ActionSheetProvider>
                <SheetProvider context="global">
                  <View onLayout={onLayoutRootView} style={{ flex: 1 }}>
                    <PricelistProvider>
                      <WalletsProvider>
                        <TransactionProvider>
                          <PasscodeGate>
                            <MainStack />
                          </PasscodeGate>
                        </TransactionProvider>
                      </WalletsProvider>
                    </PricelistProvider>
                  </View>
                </SheetProvider>
              </ActionSheetProvider>
            </QueryClientProvider>
          </Provider>
        </PersistGate>
      </NostrProvider>
    </SafeAreaProvider>
  );
}
