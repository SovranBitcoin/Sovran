import 'global.css';

// Import core libraries
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Animated, Dimensions, StatusBar, LogBox, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { View } from 'components/common/Themed';

// Import third-party libraries
import 'intl';
import 'intl/locale-data/jsonp/en';
import 'react-native-gesture-handler';
import { PersistGate } from 'redux-persist/integration/react';
import { Provider, useSelector } from 'react-redux';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Easing } from 'react-native-reanimated';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import { SheetProvider } from 'react-native-actions-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react-native';
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
import { useNostr } from 'helper/redux/nostr';
import { getFollowedUsers } from './ProfilePage';
import ndk from 'components/ndk';
import 'components/layout/sheets/registerSheets';
import { MODAL_SCREENS, MODAL_SCREENS_ALT } from 'helper/navigation/screens';
import { TransactionProvider } from 'components/providers/TransactionsProvider';

// Configure constants
const RELAY_URLS = [
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://nostr.thank.eu',
  'wss://relay.vanderwarker.family',
  'wss://nostr-relay.bitcoin.ninja',
  'wss://lnbits.btc-payserver.eu/nostrrelay/1',
  'wss://relay.damus.io',
  'wss://nostr.girino.org',
  'wss://relay.8333.space/',
  'wss://relay.snort.social',
  'wss://nostr.mutinywallet.com',
  'wss://nos.lol',
];

const SENTRY_DSN =
  'https://50c53b9362d6d884a469eb0214dbdf94@o4508635578236928.ingest.de.sentry.io/4508635580530768';

// Initialize global configurations
LogBox.ignoreAllLogs();
dayjs.extend(relativeTime);

// Initialize Sentry
Sentry.init({
  dsn: SENTRY_DSN,
  sendDefaultPii: true,
});

// Initialize QueryClient
const queryClient = new QueryClient();

// Font mapping
const FONTS = {
  OverpassBold: require('../assets/fonts/Overpass/overpass-bold.otf'),
  OverpassBoldItalic: require('../assets/fonts/Overpass/overpass-bold-italic.otf'),
  OverpassExtraboldItalic: require('../assets/fonts/Overpass/overpass-extrabold-italic.otf'),
  OverpassExtrabold: require('../assets/fonts/Overpass/overpass-extrabold.otf'),
  OverpassExtralightItalic: require('../assets/fonts/Overpass/overpass-extralight-italic.otf'),
  OverpassExtralight: require('../assets/fonts/Overpass/overpass-extralight.otf'),
  OverpassHeavyItalic: require('../assets/fonts/Overpass/overpass-heavy-italic.otf'),
  OverpassHeavy: require('../assets/fonts/Overpass/overpass-heavy.otf'),
  OverpassItalic: require('../assets/fonts/Overpass/overpass-italic.otf'),
  OverpassLightItalic: require('../assets/fonts/Overpass/overpass-light-italic.otf'),
  OverpassLight: require('../assets/fonts/Overpass/overpass-light.otf'),
  OverpassRegular: require('../assets/fonts/Overpass/overpass-regular.otf'),
  OverpassSemiboldItalic: require('../assets/fonts/Overpass/overpass-semibold-italic.otf'),
  OverpassSemibold: require('../assets/fonts/Overpass/overpass-semibold.otf'),
  OverpassThinItalic: require('../assets/fonts/Overpass/overpass-thin-italic.otf'),
  OverpassThin: require('../assets/fonts/Overpass/overpass-thin.otf'),
  OverpassMono: require('../assets/fonts/Overpass/OverpassMono-VariableFont_wght.ttf'),
  ChivoMono: require('../assets/fonts/Overpass/ChivoMono-VariableFont_wght.ttf'),
  Merienda: require('../assets/fonts/Overpass/Merienda-VariableFont_wght.ttf'),
  LexendThin: require('../assets/fonts/Lexend/Lexend-Thin.ttf'),
  LexendSemiBold: require('../assets/fonts/Lexend/Lexend-SemiBold.ttf'),
  LexendRegular: require('../assets/fonts/Lexend/Lexend-Regular.ttf'),
  LexendMedium: require('../assets/fonts/Lexend/Lexend-Medium.ttf'),
  LexendLight: require('../assets/fonts/Lexend/Lexend-Light.ttf'),
  LexendExtraLight: require('../assets/fonts/Lexend/Lexend-ExtraLight.ttf'),
  LexendExtraBold: require('../assets/fonts/Lexend/Lexend-ExtraBold.ttf'),
  LexendBold: require('../assets/fonts/Lexend/Lexend-Bold.ttf'),
  LexendBlack: require('../assets/fonts/Lexend/Lexend-Black.ttf'),
  ...FontAwesome.font,
};

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
        } catch (err) {}
      });
    };

    fetchDMs();
  }, [currentProfile.pubkey, currentProfile.nsec, addMessage, messages]);
}

/**
 * Splash screen component
 */
function MySplashScreen({ opacity }) {
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
        source={require('assets/images/bg_.png')}
      />
    </Animated.View>
  );
}

/**
 * Stack navigation component
 */
function MainStack() {
  const currentProfile = useSelector((state) => state.nostr.currentProfile);
  const { addMessage, messages, setFollows } = useNostr();
  const theme = memoizedGetTheme(store.getState());

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
        backgroundColor: currentProfile.pubkey ? greys(theme)[2300] : 'transparent',
      },
      headerLargeStyle: {
        backgroundColor: currentProfile.pubkey ? greys(theme)[2300] : 'transparent',
      },
      ...screenName.options,
    };
  };

  return (
    <>
      <StatusBar
        backgroundColor={greys(theme)[2300]}
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
  const [fontsLoaded, fontsError] = useFonts(FONTS);

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
                    <TransactionProvider>
                      <MainStack />
                    </TransactionProvider>
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
