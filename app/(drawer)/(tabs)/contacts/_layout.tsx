import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useHeaderSearch } from '@/shared/hooks/useHeaderSearch';
import { Stack } from 'expo-router';
import { Pressable, useWindowDimensions } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { createContext, useContext, useCallback, useMemo } from 'react';
import { buildExpoRouterHeaderOptions } from '@/navigation/nativeTabs';
import { GlassSearchBar } from '@/shared/ui/composed/GlassSearchBar';
import { getHeaderTitleWidthFromWidth } from '@/features/wallet/lib/walletHeader';

interface ContactsSearchContextValue {
  isSearching: boolean;
  searchQuery: string;
  clearKey: number;
  onSearchChange: (query: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
}

const ContactsSearchContext = createContext<ContactsSearchContextValue | null>(null);

export const useContactsSearch = () => {
  const context = useContext(ContactsSearchContext);
  if (!context) throw new Error('useContactsSearch must be used within ContactsLayout');
  return context;
};

export default function ContactsLayout() {
  const iconColor = useThemeColor('foreground');
  const navigation = useNavigation();
  const { width: windowWidth } = useWindowDimensions();
  const searchBarWidth = getHeaderTitleWidthFromWidth(windowWidth);

  const {
    isSearching,
    searchQuery,
    clearKey,
    onOpenSearch: handleOpenSearch,
    onCloseSearch: handleCloseSearch,
    onSearchChange: handleSearchChange,
  } = useHeaderSearch();

  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  // Stable headerTitle callback — must not depend on isSearching to avoid
  // re-mounting and losing keyboard focus once search is open.
  const headerTitle = useCallback(
    () => (
      <GlassSearchBar
        width={searchBarWidth}
        clearKey={clearKey}
        onChangeText={handleSearchChange}
        placeholder="Search contacts..."
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
        title: 'Contacts',
      },
    });
  }, [isSearching, iconColor, openDrawer, headerRight, headerTitle, headerSearchIcon]);

  const contextValue: ContactsSearchContextValue = {
    isSearching,
    searchQuery,
    clearKey,
    onSearchChange: handleSearchChange,
    onOpenSearch: handleOpenSearch,
    onCloseSearch: handleCloseSearch,
  };

  return (
    <ContactsSearchContext.Provider value={contextValue}>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: 'transparent',
          },
        }}>
        <Stack.Screen name="index" options={screenOptions} />
      </Stack>
    </ContactsSearchContext.Provider>
  );
}
