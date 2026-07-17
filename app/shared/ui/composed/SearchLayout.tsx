import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { useWindowDimensions, View as RNView } from 'react-native';
import { Stack, useNavigation } from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeaderSearch } from '@/shared/hooks/useHeaderSearch';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { buildExpoRouterHeaderOptions, HeaderIconButton } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { getHeaderTitleWidthFromWidth, HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
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

function SearchBarTitle({ placeholder, testID }: { placeholder: string; testID?: string }) {
  const { clearKey, seedText, onSearchChange } = useSearchContext();
  const { width } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(width);

  return (
    <RNView style={liquidTitleBiasStyle}>
      <GlassSearchBar
        testID={testID}
        width={searchBarWidth}
        // Match the mint selector pill exactly — the search bar swaps into
        // the same title slot, and a shorter field reads as a jarring jump.
        height={HEADER_LAYOUT.BUTTON_HEIGHT}
        clearKey={clearKey}
        seedText={seedText}
        onChangeText={onSearchChange}
        placeholder={placeholder}
        keyboardType="web-search"
        debounceMs={300}
        autoFocus
      />
    </RNView>
  );
}

// Measured on device (320pt window): UIKit places a fitting custom
// titleView at +2pt right of true center on iOS 26 even with perfectly
// symmetric bar items (probe data: left gap 16 / right gap 12). The bias is
// additive, so it can't be fixed with width math — compensate the title
// content by the same constant. Tune here if a different device class
// measures a different bias.
const LIQUID_TITLE_BIAS_PX = -2;
const liquidTitleBiasStyle = supportsLiquidGlass()
  ? { transform: [{ translateX: LIQUID_TITLE_BIAS_PX }] }
  : null;

function SearchHeaderRight({ testID }: { testID?: string }) {
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
      testID={testID}
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
  /**
   * Per-tab e2e id prefix: `<prefix>-search-toggle` on the header button and
   * `<prefix>-search-input` on the search bar (the Wallet passes "wallet").
   */
  searchTestIDPrefix?: string;
};

export function SearchLayout({
  title,
  placeholder,
  renderIdleTitle,
  transparent = false,
  searchTestIDPrefix,
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
    () => (
      <SearchBarTitle
        placeholder={placeholder}
        testID={searchTestIDPrefix ? `${searchTestIDPrefix}-search-input` : undefined}
      />
    ),
    [placeholder, searchTestIDPrefix]
  );
  const headerRight = useCallback(
    () => (
      <SearchHeaderRight
        testID={searchTestIDPrefix ? `${searchTestIDPrefix}-search-toggle` : undefined}
      />
    ),
    [searchTestIDPrefix]
  );
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
              ? {
                  headerTitle: () => (
                    <RNView style={liquidTitleBiasStyle}>{renderIdleTitle()}</RNView>
                  ),
                }
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
