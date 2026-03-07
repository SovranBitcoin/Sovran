import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { Pressable, useWindowDimensions } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { createContext, useContext, useState, useCallback } from 'react';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [clearKey, setClearKey] = useState(0);

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setClearKey((prev) => prev + 1);
  }, []);

  const isSearching = searchQuery.trim().length > 0;

  const { width: windowWidth } = useWindowDimensions();
  const headerWidth = windowWidth - 124 - 24;

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
        <Stack.Screen
          name="index"
          options={buildExpoRouterHeaderOptions({
            iconColor,
            headerLeftIcon: 'line.3.horizontal',
            onHeaderLeftPress: openDrawer,
            headerRight: () => (
              <Pressable onPress={handleClearSearch} style={{ padding: 8 }}>
                <IconSymbol name="xmark" size={20} color={iconColor} />
              </Pressable>
            ),
            options: {
              headerTransparent: true,
              headerTitle: () => (
                <GlassSearchBar
                  width={headerWidth}
                  clearKey={clearKey}
                  onChangeText={handleSearchChange}
                  placeholder="Search contacts..."
                  keyboardType="web-search"
                />
              ),
            },
          })}
        />
      </Stack>
    </PaymentsSearchContext.Provider>
  );
}
