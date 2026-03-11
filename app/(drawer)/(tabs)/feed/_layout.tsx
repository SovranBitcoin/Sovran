import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Stack } from 'expo-router';
import { Keyboard, Pressable, useWindowDimensions } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';

interface FeedSearchContextValue {
  isSearching: boolean;
  searchQuery: string;
  clearKey: number;
  onSearchChange: (query: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
}

const FeedSearchContext = createContext<FeedSearchContextValue | null>(null);

export const useFeedSearch = () => {
  const context = useContext(FeedSearchContext);
  if (!context) throw new Error('useFeedSearch must be used within FeedLayout');
  return context;
};

export default function FeedLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(windowWidth);

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [clearKey, setClearKey] = useState(0);

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const handleOpenSearch = useCallback(() => {
    setIsSearching(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearching(false);
    setSearchQuery('');
    setClearKey((prev) => prev + 1);
    Keyboard.dismiss();
  }, []);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Stable headerTitle callback — must not depend on isSearching to avoid
  // re-mounting and losing keyboard focus once search is open.
  const headerTitle = useCallback(
    () => (
      <GlassSearchBar
        width={searchBarWidth}
        clearKey={clearKey}
        onChangeText={handleSearchChange}
        placeholder="Search people..."
        keyboardType="web-search"
        debounceMs={300}
        autoFocus
      />
    ),
    [clearKey, handleSearchChange, searchBarWidth]
  );

  const headerRight = useCallback(
    () => (
      <Pressable onPress={handleCloseSearch} style={{ padding: 8 }}>
        <IconSymbol name="xmark" size={20} color={iconColor} />
      </Pressable>
    ),
    [handleCloseSearch, iconColor]
  );

  const headerSearchIcon = useCallback(
    () => (
      <Pressable onPress={handleOpenSearch} style={{ padding: 8 }}>
        <IconSymbol name="magnifyingglass" size={20} color={iconColor} />
      </Pressable>
    ),
    [handleOpenSearch, iconColor]
  );

  const screenOptions = useMemo(() => {
    if (isSearching) {
      return buildExpoRouterHeaderOptions({
        iconColor,
        headerLeftIcon: 'line.3.horizontal',
        onHeaderLeftPress: openDrawer,
        headerRight,
        options: {
          headerTitle,
        },
      });
    }
    return buildExpoRouterHeaderOptions({
      iconColor,
      headerLeftIcon: 'line.3.horizontal',
      onHeaderLeftPress: openDrawer,
      headerRight: headerSearchIcon,
      options: {
        title: 'Feed',
      },
    });
  }, [isSearching, iconColor, openDrawer, headerRight, headerTitle, headerSearchIcon]);

  const contextValue: FeedSearchContextValue = {
    isSearching,
    searchQuery,
    clearKey,
    onSearchChange: handleSearchChange,
    onOpenSearch: handleOpenSearch,
    onCloseSearch: handleCloseSearch,
  };

  return (
    <FeedSearchContext.Provider value={contextValue}>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: 'transparent',
          },
        }}>
        <Stack.Screen name="index" options={screenOptions} />
      </Stack>
    </FeedSearchContext.Provider>
  );
}
