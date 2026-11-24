import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import type { SearchBarCommands } from 'react-native-screens';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { UnifiedSearch } from '@/shared/ui/composed/search/UnifiedSearch';
import { View } from '@/shared/ui/primitives/View/View';

/**
 * The native header search bar (iOS). iOS 26 joins it to the tab bar's
 * `role="search"` item. Android's field is the layout's title instead.
 */
function IosHeaderSearchBar() {
  const { placeholder, clearKey, seedText, onSearchChange } = useSearchContext();
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const searchBarRef = useRef<SearchBarCommands | null>(null);

  // A query run from outside the field (a recent search) is written into it.
  useEffect(() => {
    if (clearKey > 0) searchBarRef.current?.setText(seedText);
  }, [clearKey, seedText]);

  return (
    <Stack.SearchBar
      ref={searchBarRef}
      placeholder={placeholder}
      autoCapitalize="none"
      hideWhenScrolling={false}
      textColor={foreground}
      hintTextColor={muted}
      tintColor={foreground}
      onChangeText={(event) => onSearchChange(event.nativeEvent.text)}
      onCancelButtonPress={() => onSearchChange('')}
    />
  );
}

/**
 * The Search tab: people, mints and places. The field lives in the tab's
 * header; this is the body under it.
 *
 * Recent queries keep the `wallet` bucket, where the wallet's header search
 * saved them before Search became a tab.
 */
export function SearchScreen() {
  useLifecycleLogger('SearchScreen');
  return (
    <View testID="search-screen" className="bg-surface flex-1">
      {Platform.OS === 'ios' ? <IosHeaderSearchBar /> : null}
      <UnifiedSearch recentContext="wallet" />
    </View>
  );
}
