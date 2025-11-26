import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'global.css';
import 'intl';
import 'intl/locale-data/jsonp/en';
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import { registerAllSheets } from '@/components/blocks/sheets/registerSheets';
import { Drawer, DrawerProvider } from '@/components/drawer';
import { relays } from '@/components/ndk';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NDKCacheAdapterSqlite, NDKPrivateKeySigner, useNDK } from '@nostr-dev-kit/ndk-mobile';
import Icon from 'assets/icons';
import { Animated, Dimensions, LogBox, TouchableOpacity } from 'react-native';

import AppGate from '@/components/blocks/AppGate';
import MigrationGate from '@/components/blocks/MigrationGate';
import { CocoProvider } from '@/helper/coco';
import { InitializationProvider } from '@/providers/InitializationProvider';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import PasscodeGate from 'components/blocks/passcode/PasscodeGate';
import { compose } from 'helper/utils';
import { NostrKeysProvider, useNostrKeysContext } from 'providers/NostrKeysProvider';
import { PricelistProvider } from 'providers/PricelistProvider';
import { ThemeProvider, useTheme } from 'providers/ThemeProvider';
import { useEffect } from 'react';
import { SheetProvider } from 'react-native-actions-sheet';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { persistor, store } from 'redux/store';
import { MODAL_SCREENS, ModalConfig } from './_layout.modals';

const cacheAdapter = new NDKCacheAdapterSqlite('nostr');

registerAllSheets({ context: 'global' });

export const unstable_settings = {
  anchor: '(tabs)',
};

const RELAY_URLS = relays;

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

export default function RootLayout() {
  const colorScheme = useColorScheme();
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
    <AppProviders>
      <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <DrawerProvider>
          <Drawer>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
          </Drawer>
          <StatusBar style="auto" />
        </DrawerProvider>
      </NavigationThemeProvider>
    </AppProviders>
  );
}
