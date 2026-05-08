import { createContext, useContext, useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeaderSearch } from '@/shared/hooks/useHeaderSearch';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';

// --- Context ---

type SearchContextValue = {
  isSearching: boolean;
  searchQuery: string;
  clearKey: number;
  onSearchChange: (query: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

export const useSearchContext = () => {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used within SearchLayout');
  return ctx;
};

// --- Header components (read state from context, identity-stable) ---

function SearchBarTitle({ placeholder }: { placeholder: string }) {
  const { clearKey, onSearchChange } = useSearchContext();
  const { width } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(width);

  return (
    <GlassSearchBar
      width={searchBarWidth}
      clearKey={clearKey}
      onChangeText={onSearchChange}
      placeholder={placeholder}
      keyboardType="web-search"
      debounceMs={300}
      autoFocus
    />
  );
}

function SearchHeaderRight() {
  const { isSearching, onOpenSearch, onCloseSearch } = useSearchContext();
  const iconColor = useThemeColor('foreground');

  return (
    <Pressable
      onPress={isSearching ? onCloseSearch : onOpenSearch}
      style={{ padding: 8 }}
      accessibilityRole="button"
      accessibilityLabel={isSearching ? 'Close search' : 'Open search'}>
      <IconSymbol name={isSearching ? 'xmark' : 'magnifyingglass'} size={20} color={iconColor} />
    </Pressable>
  );
}

// --- Layout component ---

type SearchLayoutProps = {
  title: string;
  placeholder: string;
};

export function SearchLayout({ title, placeholder }: SearchLayoutProps) {
  const iconColor = useThemeColor('foreground');
  const surface = useThemeColor('surface');
  const navigation = useNavigation();
  const search = useHeaderSearch();

  const openDrawer = useCallback(
    () => navigation.dispatch(DrawerActions.openDrawer()),
    [navigation]
  );

  // Only render custom headerTitle when searching (shows GlassSearchBar).
  // When not searching, let React Navigation render the native title
  // so it picks up the correct tintColor / Liquid Glass styling.
  const searchBarTitle = useCallback(
    () => <SearchBarTitle placeholder={placeholder} />,
    [placeholder]
  );
  const headerRight = useCallback(() => <SearchHeaderRight />, []);

  const screenOptions = useMemo(
    () =>
      buildExpoRouterHeaderOptions({
        iconColor,
        headerLeftIcon: 'line.3.horizontal',
        onHeaderLeftPress: openDrawer,
        headerRight,
        options: {
          title,
          headerStyle: { backgroundColor: surface },
          ...(search.isSearching ? { headerTitle: searchBarTitle } : {}),
        },
      }),
    [iconColor, openDrawer, headerRight, surface, title, search.isSearching, searchBarTitle]
  );

  const contextValue: SearchContextValue = useMemo(
    () => ({
      isSearching: search.isSearching,
      searchQuery: search.searchQuery,
      clearKey: search.clearKey,
      onSearchChange: search.onSearchChange,
      onOpenSearch: search.onOpenSearch,
      onCloseSearch: search.onCloseSearch,
    }),
    [
      search.isSearching,
      search.searchQuery,
      search.clearKey,
      search.onSearchChange,
      search.onOpenSearch,
      search.onCloseSearch,
    ]
  );

  return (
    <SearchContext.Provider value={contextValue}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: surface } }}>
        <Stack.Screen name="index" options={screenOptions} />
      </Stack>
    </SearchContext.Provider>
  );
}
