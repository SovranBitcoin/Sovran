import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { Keyboard, Pressable, useWindowDimensions } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';

// Search context for sharing state between layout and index
interface PaymentsSearchContextValue {
  searchQuery: string;
  isSearching: boolean;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
}

const PaymentsSearchContext = createContext<PaymentsSearchContextValue | null>(null);

export const usePaymentsSearch = () => {
  const context = useContext(PaymentsSearchContext);
  if (!context) {
    throw new Error('usePaymentsSearch must be used within PaymentsLayout');
  }
  return context;
};

export default function PaymentsLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(windowWidth);
  const [searchQuery, setSearchQuery] = useState('');
  const [clearKey, setClearKey] = useState(0);

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setClearKey((prev) => prev + 1);
    Keyboard.dismiss();
  }, []);

  const isSearching = searchQuery.trim().length > 0;

  // Stable header callbacks — these must NOT depend on isSearching,
  // otherwise React Navigation re-renders the header and the TextInput
  // loses focus (keyboard dismisses).
  const headerTitle = useCallback(
    () => (
      <GlassSearchBar
        width={searchBarWidth}
        clearKey={clearKey}
        onChangeText={handleSearchChange}
        placeholder="Search contacts..."
        keyboardType="web-search"
        debounceMs={300}
      />
    ),
    [clearKey, handleSearchChange]
  );

  // Always visible X — tapping when empty is harmless (clears '' → '').
  // Keeping this stable prevents header layout shifts that kill focus.
  const headerRight = useCallback(
    () => (
      <Pressable onPress={handleClearSearch} style={{ padding: 8 }}>
        <IconSymbol name="xmark" size={20} color={iconColor} />
      </Pressable>
    ),
    [handleClearSearch, iconColor]
  );

  const screenOptions = useMemo(
    () =>
      buildExpoRouterHeaderOptions({
        iconColor,
        headerLeftIcon: 'line.3.horizontal',
        onHeaderLeftPress: openDrawer,
        headerRight,
        options: {
          headerTransparent: true,
          headerTitle,
        },
      }),
    [iconColor, openDrawer, headerRight, headerTitle]
  );

  const contextValue: PaymentsSearchContextValue = {
    searchQuery,
    isSearching,
    onSearchChange: handleSearchChange,
    onClearSearch: handleClearSearch,
  };

  return (
    <PaymentsSearchContext.Provider value={contextValue}>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: 'transparent',
          },
        }}>
        <Stack.Screen name="index" options={screenOptions} />
      </Stack>
    </PaymentsSearchContext.Provider>
  );
}
