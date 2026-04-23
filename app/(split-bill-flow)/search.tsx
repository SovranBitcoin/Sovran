/**
 * @fileoverview Split-Bill — Nostr search modal.
 *
 * Opened from the Who Pays screen's headerRight magnifier. Presents as an
 * expo-router modal (iOS sheet, native swipe-down-to-dismiss; Android
 * slide-up with hardware back to dismiss). Contains an auto-focused
 * search input and a LegendList of Nostr profile search results —
 * nothing else from the main picker screen (BLE / Recent / Your Accounts
 * stay on the main screen).
 *
 * Selection flows through the shared picker context hosted in
 * `_layout.tsx`, so tapping results in this modal toggles the same
 * `selectedIds` set the main screen reads. The modal stays open on tap
 * (multi-select); user dismisses manually when done.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, type LayoutChangeEvent } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList } from '@legendapp/list';
import { useRouter } from 'expo-router';
import opacity from 'hex-color-opacity';

import { useSplitBillPickerContext } from './_layout';
import { ParticipantRow } from '@/features/splitBill/components/ParticipantRow';
import type { PickerCandidate } from '@/features/splitBill/hooks/useSplitBillParticipantPicker';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { ListRow } from '@/shared/ui/composed/ListRow';
import Icon from 'assets/icons';
import { Screen, useLifecycleLogger, walletLog } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export default function SplitBillSearchScreen() {
  useLifecycleLogger('SplitBillSearchScreen', walletLog);
  const router = useRouter();

  const [foreground, background, surfaceSecondary] = useThemeColor([
    'foreground',
    'background',
    'surface-secondary',
  ] as const);

  const { searchCandidates, searchQuery, setSearchQuery, searchLoading, selectedIds, toggle } =
    useSplitBillPickerContext();

  const insets = useSafeAreaInsets();

  const handleDone = useCallback(async () => {
    router.back();
  }, [router]);

  // Measure the Done bar so the list can reserve bottom padding under it —
  // without this reservation the last search result would sit behind the
  // sticky button when the keyboard is open.
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  const handleBottomBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBottomBarHeight(e.nativeEvent.layout.height);
  }, []);

  // iOS: the modal's slide-in animation can race with `.focus()` — the
  // keyboard opens but the input loses focus after the animation frame.
  // A ~120ms delay waits out the transition reliably across the devices
  // the team has tested on.
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: PickerCandidate }) => (
      <ParticipantRow
        candidate={item}
        selected={selectedIds.has(item.id)}
        onToggle={toggle}
      />
    ),
    [selectedIds, toggle]
  );

  const keyExtractor = useCallback((item: PickerCandidate) => item.id, []);

  return (
    // `KeyboardStickyView` translates the Done bar up by the keyboard height
    // when it opens. On iOS modal sheets, KAV's padding math goes wrong
    // because the sheet's coord system differs from the screen's — it
    // either leaves the button under the keyboard or over-pads it. Sticky
    // view is the right primitive here.
    //
    // The `opened: insets.bottom` correction: when the keyboard is closed
    // the button sits at the sheet's bottom safe-area inset (above the
    // home indicator). A translate of exactly `-keyboardHeight` therefore
    // overshoots the keyboard top by `insets.bottom`. Adding it back on
    // the `opened` side cancels that overshoot so the button lands flush
    // on the keyboard.
    <Screen name="SplitBillSearchScreen" style={{ flex: 1, backgroundColor: background }}>
      <View style={[styles.inputWrapper, { backgroundColor: surfaceSecondary }]}>
        <Icon name="mdi:magnify" size={18} color={opacity(foreground, 0.5)} />
        <TextInput
          ref={inputRef}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search Nostr for anyone…"
          placeholderTextColor={opacity(foreground, 0.4)}
          style={[styles.input, { color: foreground }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>

      <LegendList
        data={searchCandidates}
        extraData={selectedIds}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        estimatedItemSize={68}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="always"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomBarHeight + 24 }}
        ListEmptyComponent={
          <SearchEmptyState
            searchQuery={searchQuery}
            searchLoading={searchLoading}
            foreground={foreground}
          />
        }
      />

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <BottomButtons
          style={{ position: 'relative', backgroundColor: background }}
          paddingBottom={16}
          onLayout={handleBottomBarLayout}>
          <HStack justify="center" align="center">
            <ButtonHandler
              buttons={[
                {
                  testID: 'split-bill-search-done',
                  text: 'Done',
                  icon: 'material-symbols:check-rounded',
                  variant: 'primary',
                  onPress: handleDone,
                },
              ]}
            />
          </HStack>
        </BottomButtons>
      </KeyboardStickyView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Empty-state components
// ---------------------------------------------------------------------------

/**
 * Picks the right empty-state render for each of the four distinct states
 * of the search surface: pre-search, sub-threshold, loading, no-results.
 *
 * `searchLoading` is checked FIRST so a refetch (user edits a query that
 * previously had results) shows skeleton rows rather than flashing the
 * "No one matches…" copy — `useContactSearch` sets `searchResults = []`
 * before the async call, and without this order we'd briefly render the
 * terminal "nothing found" state during an in-flight request.
 */
function SearchEmptyState({
  searchQuery,
  searchLoading,
  foreground,
}: {
  searchQuery: string;
  searchLoading: boolean;
  foreground: string;
}) {
  if (searchLoading) return <SkeletonRows count={4} />;
  if (!searchQuery) {
    return (
      <CenteredEmpty
        icon="mdi:account-circle"
        title="Find someone on Nostr"
        body="Search by name, NIP-05, or pubkey."
        foreground={foreground}
      />
    );
  }
  if (searchQuery.length < 2) {
    return (
      <CenteredEmpty
        icon="mdi:magnify"
        title="Keep typing"
        body="Enter at least 2 characters to search."
        foreground={foreground}
      />
    );
  }
  return (
    <CenteredEmpty
      icon="mdi:magnify"
      title={`No one matches "${searchQuery}"`}
      body="Check the spelling, or try their NIP-05 address or npub."
      foreground={foreground}
    />
  );
}

/**
 * Shimmer-bar placeholder rows reused from `ListRow`'s built-in loading
 * mode — matches the exact silhouette of a real result row so swap-in
 * on results-arrive is visually seamless.
 */
function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ListRow
          key={`sk-${i}`}
          avatar={{ state: 'loading', size: 44 }}
          loading
          titlePlaceholder="A display name"
          subtitlePlaceholder="user@relay.example"
        />
      ))}
    </>
  );
}

function CenteredEmpty({
  icon,
  title,
  body,
  foreground,
}: {
  icon: string;
  title: string;
  body: string;
  foreground: string;
}) {
  return (
    <VStack align="center" spacing={8} style={styles.emptyBlock}>
      <Icon name={icon} size={32} color={opacity(foreground, 0.3)} />
      <Text size={16} bold style={{ color: opacity(foreground, 0.7), textAlign: 'center' }}>
        {title}
      </Text>
      <Text
        size={14}
        style={{
          color: opacity(foreground, 0.5),
          textAlign: 'center',
          paddingHorizontal: 32,
        }}>
        {body}
      </Text>
    </VStack>
  );
}

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 22,
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  emptyBlock: {
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
});
