import { useCallback, useEffect, useRef } from 'react';
import { Platform, type NativeSyntheticEvent, type TextInputFocusEventData } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import type { SearchBarCommands } from 'react-native-screens';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { useSearchContext } from '@/shared/ui/composed/SearchLayout';
import { registerNativeSearchDismiss } from '@/shared/ui/composed/search/nativeSearchDismiss';
import { UnifiedSearch } from '@/shared/ui/composed/search/UnifiedSearch';
import { View } from '@/shared/ui/primitives/View/View';

const SUPPRESS_CANCEL_CLEAR_MS = 500;

/**
 * The native header search bar (iOS). iOS 26 joins it to the tab bar's
 * `role="search"` item. Android's field is the layout's title instead.
 *
 * Callbacks are stabilized through refs so `<Stack.SearchBar />` does not
 * re-run `navigation.setOptions({ headerSearchBarOptions })` on every
 * keystroke, and an active `UISearchController` is cleanly deactivated before
 * pushing a root-stack route so iOS 26's native tab bar stays intact on back.
 */
function IosHeaderSearchBar() {
  const { placeholder, clearKey, seedText, searchQuery, onSearchChange } = useSearchContext();
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const searchBarRef = useRef<SearchBarCommands | null>(null);

  const onSearchChangeRef = useRef(onSearchChange);
  const searchQueryRef = useRef(searchQuery);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
    searchQueryRef.current = searchQuery;
  }, [onSearchChange, searchQuery]);

  // Tracks whether `UISearchController.active` is currently true (survives
  // keyboard blur when the user taps Search on the keyboard).
  const controllerActiveRef = useRef(false);
  // Ignores the synthetic `onCancelButtonPress` + `onChangeText('')` pair
  // emitted by `RNSSearchBar.cancelSearch()` during programmatic deactivation.
  const suppressClearRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when programmatic deactivation cleared the native input while keeping
  // `searchQuery` in JS, so refocusing restores the text cleanly.
  const needsTextSyncRef = useRef(false);

  const clearSuppressTimer = useCallback(() => {
    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, []);

  const dismissActiveController = useCallback((): boolean => {
    if (!controllerActiveRef.current) return false;
    controllerActiveRef.current = false;
    suppressClearRef.current = true;
    needsTextSyncRef.current = searchQueryRef.current.length > 0;
    clearSuppressTimer();
    suppressTimerRef.current = setTimeout(() => {
      suppressClearRef.current = false;
      suppressTimerRef.current = null;
    }, SUPPRESS_CANCEL_CLEAR_MS);
    searchBarRef.current?.cancelSearch();
    return true;
  }, [clearSuppressTimer]);

  useEffect(() => {
    const unregister = registerNativeSearchDismiss(dismissActiveController);
    return () => {
      unregister();
      clearSuppressTimer();
    };
  }, [dismissActiveController, clearSuppressTimer]);

  // Safety net for any navigation leaving the Search tab (Pay, drawer, tab
  // switch) that did not go through `runAfterNativeSearchDismiss`.
  useFocusEffect(
    useCallback(
      () => () => {
        dismissActiveController();
      },
      [dismissActiveController]
    )
  );

  // A query run from outside the field (a recent search) is written into it.
  useEffect(() => {
    if (clearKey > 0) {
      needsTextSyncRef.current = false;
      searchBarRef.current?.setText(seedText);
    }
  }, [clearKey, seedText]);

  const handleFocus = useCallback(() => {
    controllerActiveRef.current = true;
    suppressClearRef.current = false;
    clearSuppressTimer();
    if (needsTextSyncRef.current && searchQueryRef.current.length > 0) {
      needsTextSyncRef.current = false;
      searchBarRef.current?.setText(searchQueryRef.current);
    }
  }, [clearSuppressTimer]);

  const handleChangeText = useCallback(
    (event: NativeSyntheticEvent<TextInputFocusEventData>) => {
      const text = event.nativeEvent.text;
      if (text.length > 0) {
        suppressClearRef.current = false;
        needsTextSyncRef.current = false;
        clearSuppressTimer();
        controllerActiveRef.current = true;
        searchQueryRef.current = text;
        onSearchChangeRef.current(text);
        return;
      }
      if (suppressClearRef.current) {
        suppressClearRef.current = false;
        clearSuppressTimer();
        return;
      }
      needsTextSyncRef.current = false;
      searchQueryRef.current = '';
      onSearchChangeRef.current('');
    },
    [clearSuppressTimer]
  );

  const handleCancelButtonPress = useCallback(() => {
    controllerActiveRef.current = false;
    // RNSSearchBar emits `onCancelButtonPress` immediately BEFORE
    // `onChangeText('')`, so keep `suppressClearRef` armed for the trailing
    // empty text event when this cancel came from `dismissActiveController`.
    if (suppressClearRef.current) return;
    needsTextSyncRef.current = false;
    searchQueryRef.current = '';
    onSearchChangeRef.current('');
  }, []);

  return (
    <Stack.SearchBar
      ref={searchBarRef}
      placeholder={placeholder}
      autoCapitalize="none"
      hideWhenScrolling={false}
      textColor={foreground}
      hintTextColor={muted}
      tintColor={foreground}
      onFocus={handleFocus}
      onChangeText={handleChangeText}
      onCancelButtonPress={handleCancelButtonPress}
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
