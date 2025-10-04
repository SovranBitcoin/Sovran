import 'global.css';

// Import core libraries
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Animated, Dimensions, StatusBar, LogBox, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { View } from 'components/ui/View';

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
import { QueryClient } from '@tanstack/react-query';
// import * as Sentry from '@sentry/react-native';
import { NostrProvider } from 'nostr-react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { bytesToHex } from '@noble/hashes/utils';
import { nip04, nip19 } from 'nostr-tools';
// migrate away from dayjs
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// Import local components and utilities
import { persistor, store } from 'helper/redux/store';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { memoizedGetCurrentProfile, useNostr } from 'helper/redux/nostr';
import ndk, { relays } from 'components/ndk';
import { MODAL_SCREENS, ModalConfig } from './_layout.modals';
import { PricelistProvider } from 'providers/PricelistProvider';
import { registerAllSheets } from 'components/blocks/sheets/registerSheets';
import PasscodeGate from 'components/blocks/passcode/PasscodeGate';
import { useFonts } from 'hooks/useFonts';
import { CocoProvider } from 'helper/coco';
import { PortalHost } from '@rn-primitives/portal';
/**
 * Splash screen component
 */

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

function MySplashScreen() {
  return (
    <Animated.Image
      style={{
        width: Dimensions.get('window').width,
        height: Dimensions.get('window').height,
      }}
      source={require('assets/images/splash.png')}
    />
  );
}

function MainStack() {
  const currentProfile = useSelector(memoizedGetCurrentProfile);
  const { addMessage, messages } = useNostr();
  const theme = useSelector(memoizedGetTheme);

  // Set up DM subscriptions
  useNostrDMs(currentProfile, addMessage, messages);

  // Screen options builder
  const getScreenOptions = (screen: ModalConfig) => {
    // If the screen has explicit options, use them
    if (screen.options) {
      return screen.options;
    }

    // Default options for screens with titles (non-modal screens)
    if (screen.title !== undefined) {
      return {
        headerShown: true,
        headerTitle: screen.title,
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
      };
    }

    // Default: no special options
    return {};
  };

  return (
    <>
      <StatusBar
        backgroundColor={greys(theme)[950]}
        barStyle={theme.id.includes('light') ? 'dark-content' : 'light-content'}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />

        {/* All screens */}
        {MODAL_SCREENS.map((screen) => (
          <Stack.Screen key={screen.name} name={screen.name} options={getScreenOptions(screen)} />
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

  const [fontsLoaded, fontsError] = useFonts();

  useEffect(() => {
    if (fontsError) throw fontsError;
  }, [fontsError]);

  useEffect(() => {
    if (fontsLoaded) {
      setTimeout(() => {
        Animated.timing(scaleRef.current, {
          toValue: 0,
          duration: 500,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(() => setAppIsReady(true));
      }, 0);
    }

    initializeNDK({
      explicitRelayUrls: RELAY_URLS,
    });
  }, [fontsLoaded, initializeNDK]);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) await SplashScreen.hideAsync();
  }, [appIsReady]);

  if (!appIsReady) {
    return <MySplashScreen />;
  }

  const containerStyle = {
    width:
      Platform.OS === 'web'
        ? Math.min(Dimensions.get('window').width, 600)
        : Dimensions.get('window').width,
  };

  return (
    <SafeAreaProvider style={containerStyle}>
      <NostrProvider relayUrls={RELAY_URLS}>
        <PersistGate loading={null} persistor={persistor}>
          <Provider store={store}>
            <CocoProvider>
              <ActionSheetProvider>
                <SheetProvider context="global">
                  <View onLayout={onLayoutRootView} style={{ flex: 1 }}>
                    <PricelistProvider>
                      <PasscodeGate>
                        <MainStack />
                        <PortalHost />
                      </PasscodeGate>
                    </PricelistProvider>
                  </View>
                </SheetProvider>
              </ActionSheetProvider>
            </CocoProvider>
          </Provider>
        </PersistGate>
      </NostrProvider>
    </SafeAreaProvider>
  );
}
