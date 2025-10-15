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
import { Provider } from 'react-redux';
import * as SplashScreen from 'expo-splash-screen';
import { Easing } from 'react-native-reanimated';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import { SheetProvider } from 'react-native-actions-sheet';
// import * as Sentry from '@sentry/react-native';
import { NostrProvider } from 'nostr-react';
import { NDKPrivateKeySigner, useNDK, NDKCacheAdapterSqlite } from '@nostr-dev-kit/ndk-mobile';
import { bytesToHex } from '@noble/hashes/utils';
import { nip04, nip19 } from 'nostr-tools';
// Import local components and utilities
import { persistor, store } from 'redux/store';
import { useTheme, ThemeProvider } from 'providers/ThemeProvider';
import { useNostrKeysContext, NostrKeysProvider } from 'providers/NostrKeysProvider';
import ndk, { relays } from 'components/ndk';
import { MODAL_SCREENS, ModalConfig } from './_layout.modals';
import { PricelistProvider } from 'providers/PricelistProvider';
import { registerAllSheets } from 'components/blocks/sheets/registerSheets';
import PasscodeGate from 'components/blocks/passcode/PasscodeGate';
import AppGate from 'components/blocks/AppGate';
import { useFonts } from 'hooks/useFonts';
import { PortalHost } from '@rn-primitives/portal';
import { compose } from 'helper/utils';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { CocoProvider } from '@/helper/coco';

const cacheAdapter = new NDKCacheAdapterSqlite('nostr');

/**
 * Splash screen component
 */

registerAllSheets({ context: 'global' });

// Configure constants
const RELAY_URLS = relays;

// Initialize global configurations
LogBox.ignoreAllLogs();

/**
 * Handles DM message fetching and decryption
 */
function useNostrDMs(addMessage: any, messages: any) {
  const { keys: nostrKeys } = useNostrKeysContext();

  useEffect(() => {
    if (!nostrKeys?.nsec) return;

    const { data: privKeyBytes } = nip19.decode(nostrKeys.nsec);
    const privKey = bytesToHex(privKeyBytes as Uint8Array);
    const pubKey = nostrKeys.pubkey;

    // Set up subscription for direct messages
    const fetchDMs = async () => {
      const filters = [{ kinds: [4], '#p': [pubKey] }];
      const subscription = ndk.subscribe(filters);

      subscription.on('event', async (event) => {
        try {
          // Skip if message already exists
          if (messages.some((msg: any) => msg.id === event.id)) return;

          const decryptedMessage = await nip04.decrypt(privKey, event.pubkey, event.content);

          addMessage(nostrKeys.pubkey, {
            sender: event.pubkey,
            receiver: nostrKeys.pubkey,
            content: decryptedMessage,
            created_at: event.created_at,
            id: event.id,
            sig: event.sig,
          });
        } catch {}
      });
    };

    fetchDMs();
  }, [nostrKeys?.pubkey, nostrKeys?.nsec, addMessage, messages]);
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
  // const { addMessage, messages } = useNostr();
  const { getPrimaryColor, currentTheme } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();
  const { init: initializeNDK } = useNDK();

  // Initialize NDK with signer when keys are available
  useEffect(() => {
    if (nostrKeys?.privateKey) {
      // @ts-ignore
      initializeNDK({
        // todo: Cache adapter
        cacheAdapter,
        explicitRelayUrls: RELAY_URLS,
        signer: new NDKPrivateKeySigner(nostrKeys.privateKey),
      });
    }
  }, [initializeNDK, nostrKeys?.privateKey]);

  // Set up DM subscriptions
  // useNostrDMs(addMessage, messages);

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
          color: getPrimaryColor('0'),
        },
        headerBlurEffect: 'regular',
        headerTransparent: true,
        headerBackTitle: 'Back',
        headerTintColor: getPrimaryColor('0'),
        headerBackTitleStyle: {
          fontSize: 16,
        },
        headerStyle: {
          backgroundColor: nostrKeys?.pubkey ? getPrimaryColor('950') : 'transparent',
        },
        headerLargeStyle: {
          backgroundColor: nostrKeys?.pubkey ? getPrimaryColor('950') : 'transparent',
        },
      };
    }

    // Default: no special options
    return {};
  };

  return (
    <>
      <StatusBar
        backgroundColor={getPrimaryColor('950')}
        barStyle={currentTheme.includes('light') ? 'dark-content' : 'light-content'}
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

const containerStyle = {
  width:
    Platform.OS === 'web'
      ? Math.min(Dimensions.get('window').width, 600)
      : Dimensions.get('window').width,
};

// Provider components for composition
const AppProviders = compose([
  [SafeAreaProvider, { style: containerStyle }],
  KeyboardProvider,
  [NostrProvider, { relayUrls: RELAY_URLS }],
  [PersistGate, { loading: null, persistor }],
  [Provider, { store }],
  ThemeProvider,
  [NostrKeysProvider, { defaultAccountIndex: 0 }],
  CocoProvider,
  ActionSheetProvider,
  [SheetProvider, { context: 'global' }],
  PricelistProvider,
  PasscodeGate,
  AppGate,
]);

/**
 * Main application component
 */
export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const scaleRef = useRef(new Animated.Value(1));
  const { getPrimaryColor } = useTheme();
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
  }, [fontsLoaded]);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) await SplashScreen.hideAsync();
  }, [appIsReady]);

  if (!appIsReady) {
    return <MySplashScreen />;
  }

  return (
    <AppProviders>
      <View
        onLayout={onLayoutRootView}
        style={{
          flex: 1,
          backgroundColor: getPrimaryColor('950'),
        }}
        className="bg-background-950">
        <MainStack />
        <PortalHost />
      </View>
    </AppProviders>
  );
}
