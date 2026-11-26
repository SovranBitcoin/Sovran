import { createContext, useContext, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { runAfterNativeSearchDismiss } from '@/shared/ui/composed/search/nativeSearchDismiss';
import { useSearchClose } from '@/shared/ui/composed/search/SearchCloseContext';
import {
  getHeaderTitleWidthBesideRightButton,
  HEADER_LAYOUT,
} from '@/features/wallet/lib/walletHeader';

// --- Context ---

type SearchContextValue = {
  /** Field hint, shared by the iOS header bar and the Android title field. */
  placeholder: string;
  searchQuery: string;
  clearKey: number;
  /** Text the search input is seeded with whenever `clearKey` changes. */
  seedText: string;
  onSearchChange: (query: string) => void;
  /** Programmatically run a query (e.g. tapping a recent-search chip). */
  setQuery: (query: string) => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

export const useSearchContext = () => {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used within SearchLayout');
  return ctx;
};

// --- Close ---

function SearchCloseButton() {
  const { close, accessibilityLabel } = useSearchClose();
  return (
    <ScreenHeaderAction
      icon="material-symbols:close-rounded"
      accessibilityLabel={accessibilityLabel}
      testID="search-close"
      // An active iOS search controller is let go first, or the tab bar breaks.
      onPress={() => runAfterNativeSearchDismiss(close)}
    />
  );
}

// --- Android header field (iOS uses the native header search bar) ---

// The field emits every keystroke, like iOS's native bar: local results answer
// at once, and the remote people search keeps the only pause
// (`SEARCH_DEBOUNCE_MS`). A debounce here would stack on top of that one.

function SearchBarTitle({ placeholder, testID }: { placeholder: string; testID?: string }) {
  const { clearKey, seedText, searchQuery, onSearchChange, setQuery } = useSearchContext();
  const { width } = useWindowDimensions();

  return (
    <GlassSearchBar
      testID={testID}
      // Starts at the edge (no left button) and stops short of the close button.
      width={getHeaderTitleWidthBesideRightButton(width)}
      height={HEADER_LAYOUT.BUTTON_HEIGHT}
      clearKey={clearKey}
      seedText={seedText}
      value={searchQuery}
      onClear={() => setQuery('')}
      onChangeText={onSearchChange}
      placeholder={placeholder}
      keyboardType="web-search"
    />
  );
}

// --- Layout component ---

type SearchLayoutProps = {
  title: string;
  placeholder: string;
  /** e2e id of the search field. */
  searchTestID?: string;
};

/**
 * The Search tab's navigator. It is a route layout, not a screen: the tab's
 * `_layout.tsx` renders it as its default export, so its `<Stack>` is the
 * file-based stack for that tab.
 *
 * The field is always in the header. On iOS the page mounts the native
 * `Stack.SearchBar`, which iOS 26 joins to the tab bar's `role="search"` item;
 * on Android this layout puts the shared glass field in the title slot.
 * The close button sits on the right, where iOS's Cancel sits while typing.
 */
export function SearchLayout({ title, placeholder, searchTestID }: SearchLayoutProps) {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const [searchQuery, setSearchQuery] = useState('');
  const [clearKey, setClearKey] = useState(0);
  const [seedText, setSeedText] = useState('');
  const setQuery = (query: string) => {
    setSearchQuery(query);
    setSeedText(query);
    setClearKey((prev) => prev + 1);
  };

  const headerRight = () => <SearchCloseButton />;

  const androidField =
    Platform.OS === 'android'
      ? {
          headerTitle: () => <SearchBarTitle placeholder={placeholder} testID={searchTestID} />,
          // Starts at the left edge; the close button takes the right.
          headerTitleAlign: 'left' as const,
        }
      : {};

  const screenOptions = buildExpoRouterHeaderOptions({
    iconColor: foreground,
    headerRight,
    options: {
      title,
      headerTitleStyle: { color: foreground },
      headerTintColor: foreground,
      // Opaque: the results start below the header instead of under it.
      headerTransparent: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: surface },
      // iOS draws the scroll-edge (large) appearance separately; without this it
      // is transparent and the black window behind the stack shows through.
      headerLargeStyle: { backgroundColor: surface },
      ...androidField,
    },
  });

  const contextValue: SearchContextValue = {
    placeholder,
    searchQuery,
    clearKey,
    seedText,
    onSearchChange: setSearchQuery,
    setQuery,
  };

  return (
    <SearchContext.Provider value={contextValue}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: surface } }}>
        <Stack.Screen name="index" options={screenOptions} />
      </Stack>
    </SearchContext.Provider>
  );
}
