import 'global.css';

// Import core libraries
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Animated, Dimensions, StatusBar, LogBox, TouchableOpacity } from 'react-native';
import { Stack, router } from 'expo-router';
import { View } from 'components/ui/View';
import Icon from 'assets/icons';

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
import { NDKPrivateKeySigner, useNDK, NDKCacheAdapterSqlite } from '@nostr-dev-kit/ndk-mobile';
// Import local components and utilities
import { persistor, store } from 'redux/store';
import { useTheme, ThemeProvider } from 'providers/ThemeProvider';
import { useNostrKeysContext, NostrKeysProvider } from 'providers/NostrKeysProvider';
import { InitializationProvider } from 'providers/InitializationProvider';
import { relays } from 'components/ndk';
import { MODAL_SCREENS, ModalConfig } from './_layout.modals';
import { PricelistProvider } from 'providers/PricelistProvider';
import { registerAllSheets } from 'components/blocks/sheets/registerSheets';
import PasscodeGate from 'components/blocks/passcode/PasscodeGate';
import AppGate from 'components/blocks/AppGate';
import MigrationGate from 'components/blocks/MigrationGate';
import { useFonts } from 'hooks/useFonts';
import { PortalHost } from '@rn-primitives/portal';
import { compose } from 'helper/utils';
import { CocoProvider } from '@/helper/coco';
import { KeyboardProvider } from 'react-native-keyboard-controller';

const cacheAdapter = new NDKCacheAdapterSqlite('nostr');

/**
 * Splash screen component
 */

registerAllSheets({ context: 'global' });

// Configure constants
const RELAY_URLS = relays;

// Initialize global configurations
LogBox.ignoreAllLogs();

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

  // Close button component for modal presentations
  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  // Screen options builder
  const getScreenOptions = (screen: ModalConfig) => {
    // Base header styling options
    const baseHeaderOptions = {
      headerTitleStyle: {
        color: getPrimaryColor('0'),
      },
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

    // Check if this is a modal/formSheet presentation
    const isModalPresentation =
      screen.options?.presentation === 'modal' || screen.options?.presentation === 'formSheet';

    // If the screen has explicit options, merge with base options
    if (screen.options) {
      return {
        ...baseHeaderOptions,
        ...screen.options,
        ...(screen.title !== undefined ? { headerTitle: screen.title } : {}),
        // Add close button for modal presentations
        ...(isModalPresentation ? { headerLeft: CloseButton } : {}),
      };
    }

    // Default options for screens with titles (non-modal screens)
    if (screen.title !== undefined) {
      return {
        ...baseHeaderOptions,
        headerShown: true,
        headerTitle: screen.title,
        headerBlurEffect: 'regular',
        headerTransparent: true,
        headerBackTitle: 'Back',
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
          contentStyle: {
            backgroundColor: getPrimaryColor('800'),
          },
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

// Provider components for composition
const AppProviders = compose([
  KeyboardProvider,
  [PersistGate, { loading: null, persistor }],
  [Provider, { store }],
  ThemeProvider,
  [InitializationProvider, { forceVisible: false }], // Set to true to always show loading screen
  MigrationGate,
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
