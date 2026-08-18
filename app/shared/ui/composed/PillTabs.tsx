/**
 * Horizontal pill-tab row — the sub-tab bar that sits under a screen's
 * top-level `UnderlineTabs` (the contacts tab's All / Recent / Requests /
 * Mints row is the reference). Promoted from
 * `features/contacts/components/search` so other screens (e.g. the receive
 * QR display's Address / BOLT 12 switcher) share the exact same look and
 * press behavior instead of re-rolling segment controls.
 */

import React, { useMemo, useRef, type RefObject } from 'react';
import { FlatList, Text, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

export const PILL_TABS_HEIGHT = 56;

type PillTabItemProps<F extends string> = {
  item: F;
  index: number;
  activeTab: F;
  flatListRef: RefObject<FlatList<F> | null>;
  onTabChange: (item: F) => void;
  icon?: string | null;
  testID?: string;
};

function PillTabItem<F extends string>({
  item,
  index,
  activeTab,
  flatListRef,
  onTabChange,
  icon,
  testID,
}: PillTabItemProps<F>) {
  const isActive = activeTab === item;
  const isPressed = useSharedValue(false);
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  // Pre-compute colors on JS thread so they can be used safely in worklets
  const pressedBg = useMemo(() => opacity(surfaceTertiary, 0.6), [surfaceTertiary]);
  const activeBg = useMemo(() => opacity(surfaceTertiary, 0.5), [surfaceTertiary]);

  const rStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: isPressed.get() ? pressedBg : 'rgba(0, 0, 0, 0)',
    };
  });

  return (
    <Log name="PillTabItem">
      <Pressable
        testID={testID}
        onPressIn={() => isPressed.set(true)}
        onPressOut={() => isPressed.set(false)}
        onPress={() => {
          onTabChange(item);
          flatListRef.current?.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5,
          });
        }}
        style={[styles.pressable, isActive && { backgroundColor: activeBg }]}>
        <Animated.View style={[styles.inner, rStyle]}>
          {icon ? <Icon name={icon} size={18} color={foreground} /> : null}
          <Text style={[styles.label, { color: foreground }]}>{item}</Text>
        </Animated.View>
      </Pressable>
    </Log>
  );
}

type PillTabsProps<F extends string> = {
  tabs: readonly F[];
  activeTab: F;
  onTabChange: (tab: F) => void;
  /** Stable per-pill accessibility identifier. */
  testIDFor?: (tab: F) => string | undefined;
  /** Extra pills rendered inline at the end of the same scrollable row. */
  trailing?: React.ReactElement | null;
};

export function PillTabs<F extends string>({
  tabs,
  activeTab,
  onTabChange,
  testIDFor,
  trailing = null,
}: PillTabsProps<F>) {
  const flatListRef = useRef<FlatList<F>>(null);

  return (
    <Log name="PillTabs">
      <View style={styles.container}>
        <FlatList
          ref={flatListRef}
          data={tabs as F[]}
          keyExtractor={(item) => item}
          renderItem={({ item, index }) => (
            <PillTabItem
              item={item}
              index={index}
              flatListRef={flatListRef}
              activeTab={activeTab}
              onTabChange={onTabChange}
              testID={testIDFor?.(item)}
            />
          )}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={trailing}
        />
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    height: PILL_TABS_HEIGHT,
    marginHorizontal: -20,
  },
  content: {
    gap: 4,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  pressable: {
    borderRadius: 999,
  },
  inner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 999,
  },
  label: {
    fontSize: 17,
  },
});
