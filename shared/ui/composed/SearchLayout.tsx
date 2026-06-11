import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeaderSearch } from '@/shared/hooks/useHeaderSearch';
import { buildExpoRouterHeaderOptions, HeaderIconButton } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';
import { HeaderProfileButton } from '@/shared/blocks/HeaderProfileButton';

// --- Context ---

type SearchContextValue = {
  isSearching: boolean;
  searchQuery: string;
  clearKey: number;
  /** Text the search input remounts with — pairs with `clearKey` to seed it. */
  seedText: string;
  onSearchChange: (query: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  /** Programmatically run a query (e.g. tapping a recent-search chip). */
  setQuery: (query: string) => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

export const useSearchContext = () => {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used within SearchLayout');
  return ctx;
};

// --- Header components (read state from context, identity-stable) ---

function SearchBarTitle({ placeholder }: { placeholder: string }) {
  const { clearKey, seedText, onSearchChange } = useSearchContext();
  const { width } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(width);

  return (
    <GlassSearchBar
      width={searchBarWidth}
      clearKey={clearKey}
      seedText={seedText}
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

  // HeaderIconButton (not IconSymbol directly): expo-symbols renders NOTHING
  // on Android for string symbol names, which left this button an invisible
  // tap target there.
  return (
    <HeaderIconButton
      icon={isSearching ? 'xmark' : 'magnifyingglass'}
      size={20}
      color={iconColor}
      onPress={isSearching ? onCloseSearch : onOpenSearch}
      accessibilityLabel={isSearching ? 'Close search' : 'Open search'}
    />
  );
}

// --- Layout component ---

type SearchLayoutProps = {
  title: string;
  placeholder: string;
  /**
   * Custom header title shown when NOT searching (the Wallet passes its
   * `MintSelector`). When searching, the `GlassSearchBar` always takes over.
   * Omitted → React Navigation renders the native `title` string.
   */
  renderIdleTitle?: () => ReactNode;
  /**
   * Transparent header + content, for a tab that paints its own background
   * (the Wallet's wallpaper). Default `false` keeps the opaque `surface`
   * behavior used by Feed/Contacts.
   */
  transparent?: boolean;
};

export function SearchLayout({
  title,
  placeholder,
  renderIdleTitle,
  transparent = false,
}: SearchLayoutProps) {
  const [iconColor, surface] = useThemeColor(['foreground', 'surface'] as const);
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
  const headerLeft = useCallback(() => <HeaderProfileButton onPress={openDrawer} />, [openDrawer]);

  const screenOptions = useMemo(
    () =>
      buildExpoRouterHeaderOptions({
        iconColor,
        headerLeft,
        headerRight,
        options: {
          title,
          // Without this, the native bar inherits the locked dark
          // `userInterfaceStyle` and renders the title white — invisible on
          // the light theme's `surface` background.
          headerTitleStyle: { color: iconColor },
          headerTintColor: iconColor,
          ...(transparent
            ? { headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }
            : { headerStyle: { backgroundColor: surface } }),
          // GlassSearchBar wins while searching; otherwise an optional custom
          // idle title (Wallet's MintSelector), else the native `title`.
          ...(search.isSearching
            ? { headerTitle: searchBarTitle }
            : renderIdleTitle
              ? { headerTitle: renderIdleTitle }
              : {}),
        },
      }),
    [
      iconColor,
      headerLeft,
      headerRight,
      surface,
      title,
      search.isSearching,
      searchBarTitle,
      renderIdleTitle,
      transparent,
    ]
  );

  const contextValue: SearchContextValue = useMemo(
    () => ({
      isSearching: search.isSearching,
      searchQuery: search.searchQuery,
      clearKey: search.clearKey,
      seedText: search.seedText,
      onSearchChange: search.onSearchChange,
      onOpenSearch: search.onOpenSearch,
      onCloseSearch: search.onCloseSearch,
      setQuery: search.setQuery,
    }),
    [
      search.isSearching,
      search.searchQuery,
      search.clearKey,
      search.seedText,
      search.onSearchChange,
      search.onOpenSearch,
      search.onCloseSearch,
      search.setQuery,
    ]
  );

  return (
    <SearchContext.Provider value={contextValue}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: transparent ? 'transparent' : surface },
        }}>
        <Stack.Screen name="index" options={screenOptions} />
      </Stack>
    </SearchContext.Provider>
  );
}
