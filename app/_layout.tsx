import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'global.css';
import 'intl';
import 'intl/locale-data/jsonp/en';
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import { registerAllSheets } from '@/components/blocks/sheets/registerSheets';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFonts } from '@/hooks/useFonts';
import Icon from 'assets/icons';
import { LogBox, TouchableOpacity } from 'react-native';

import AppGate from '@/components/blocks/AppGate';
import MigrationGate from '@/components/blocks/MigrationGate';
import { CocoProvider } from '@/helper/coco';
import { InitializationProvider } from '@/providers/InitializationProvider';
import { ActionSheetProvider } from '@expo/react-native-action-sheet';
import PasscodeGate from 'components/blocks/passcode/PasscodeGate';
import { compose } from 'helper/utils';
import { NostrKeysProvider, useNostrKeysContext } from 'providers/NostrKeysProvider';
import { NostrNDKProvider } from 'providers/NostrNDKProvider';
import { PricelistProvider } from 'providers/PricelistProvider';
import { ThemeProvider, useTheme } from 'providers/ThemeProvider';
import { useEffect } from 'react';
import { SheetProvider } from 'react-native-actions-sheet';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { persistor, store } from 'redux/store';
import { MODAL_SCREENS, ModalConfig } from './_layout.modals';
import { getBaseModalHeaderOptions } from './_layout.modals.config';

// Prevent splash screen from auto-hiding until fonts are loaded
SplashScreen.preventAutoHideAsync();

registerAllSheets({ context: 'global' });

LogBox.ignoreAllLogs();

// Provider components for composition
const AppProviders = compose([
  KeyboardProvider,
  [PersistGate, { loading: null, persistor }],
  [Provider, { store }],
  ThemeProvider,
  [InitializationProvider, { forceVisible: false }], // Set to true to always show loading screen
  MigrationGate,
  [NostrKeysProvider, { defaultAccountIndex: 0 }],
  NostrNDKProvider, // Initialize NDK with signer after keys are available
  CocoProvider,
  ActionSheetProvider,
  [SheetProvider, { context: 'global' }],
  PricelistProvider,
  PasscodeGate,
  AppGate,
]);

// Inner component that can access theme context
function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const { getPrimaryColor, currentTheme } = useTheme();
  const { keys: nostrKeys } = useNostrKeysContext();

  // Close button component for modal presentations
  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  // Screen options builder
  const getScreenOptions = (screen: ModalConfig) => {
    // Base header styling options from shared config
    const backgroundColor = nostrKeys?.pubkey ? getPrimaryColor('950') : 'transparent';
    const baseHeaderOptions = getBaseModalHeaderOptions(getPrimaryColor, backgroundColor);

    // Check if this is a modal/formSheet presentation
    const isModalPresentation =
      screen.options?.presentation === 'modal' || screen.options?.presentation === 'formSheet';

    // If headerShown is explicitly false, the nested layout handles headers
    // Don't add any header-related options
    if (screen.options?.headerShown === false) {
      return {
        ...screen.options,
        // Ensure no header-related options leak through
        headerBackButtonDisplayMode: 'minimal' as const,
      };
    }

    // If the screen has explicit options, merge with base options
    if (screen.options) {
      // If headerTransparent is true, use transparent background to avoid opaque header
      const headerStyleOverride = screen.options.headerTransparent
        ? {
            headerStyle: { backgroundColor: 'transparent' },
            headerLargeStyle: { backgroundColor: 'transparent' },
          }
        : {};

      return {
        ...baseHeaderOptions,
        ...screen.options,
        ...headerStyleOverride,
        ...(screen.title !== undefined ? { headerTitle: screen.title } : {}),
        // Add close button for modal presentations (only when header is shown)
        ...(isModalPresentation ? { headerLeft: CloseButton } : {}),
      };
    }

    // Default options for screens with titles (non-modal screens)
    if (screen.title !== undefined) {
      return {
        ...baseHeaderOptions,
        headerShown: true,
        headerTitle: screen.title,
        headerBlurEffect: 'regular' as const,
        headerTransparent: true,
        headerStyle: { backgroundColor: 'transparent' },
        headerLargeStyle: { backgroundColor: 'transparent' },
        headerBackTitle: 'Back',
      };
    }

    // Default: no special options
    return {};
  };

  return (
    <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar
        backgroundColor={getPrimaryColor('950')}
        style={currentTheme.includes('light') ? 'dark' : 'light'}
      />
      <Stack
        key={currentTheme}
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          contentStyle: {
            backgroundColor: getPrimaryColor('950'),
          },
        }}>
        {/* Main drawer with tabs inside */}
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />

        {/* All modal screens configured from MODAL_SCREENS */}
        {MODAL_SCREENS.map((screen) => (
          <Stack.Screen key={screen.name} name={screen.name} options={getScreenOptions(screen)} />
        ))}
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts();

  // Hide splash screen once fonts are loaded
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Don't render anything until fonts are loaded
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AppProviders>
      <RootLayoutContent />
    </AppProviders>
  );
}
