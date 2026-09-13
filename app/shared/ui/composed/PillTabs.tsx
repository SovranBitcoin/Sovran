/**
 * Horizontal pill-tab row — the sub-tab bar that sits under a screen's
 * top-level `UnderlineTabs` (the contacts tab's All / Recent / Requests /
 * Mints row is the reference). Promoted from
 * `features/contacts/components/search` so other screens (e.g. the receive
 * QR display's Address / BOLT 12 switcher) share the exact same look and
 * press behavior instead of re-rolling segment controls.
 */

import React, { useMemo, useRef, type RefObject } from 'react';
// Tolerated seam exception: short fixed horizontal pill bar, not a data list.
// ast-grep-ignore: flatlist-outside-list-seam-tsx
import { FlatList, Text, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { withAlpha } from '@/shared/lib/color';

import Icon from '@/assets/icons';
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
  label: string;
  accessibilityRole?: 'tab' | 'radio';
  icon?: string | null;
  testID?: string;
  disabled?: boolean;
  selectedVariant: 'tint' | 'contrast';
};

function PillTabItem<F extends string>({
  item,
  index,
  activeTab,
  flatListRef,
  onTabChange,
  icon,
  label,
  accessibilityRole,
  testID,
  disabled = false,
  selectedVariant,
}: PillTabItemProps<F>) {
  const isActive = activeTab === item;
  const contrast = isActive && selectedVariant === 'contrast';
  const isPressed = useSharedValue(false);
  const [foreground, background, surfaceTertiary] = useThemeColor([
    'foreground',
    'background',
    'surface-tertiary',
  ] as const);

  // Pre-compute colors on JS thread so they can be used safely in worklets
  const pressedBg = useMemo(() => withAlpha(surfaceTertiary, 0.6), [surfaceTertiary]);
  const activeBg = useMemo(
    // `contrast` inverts the pill like a primary button (foreground fill,
    // background text) so the chosen option reads at a glance; `tint` is the
    // translucent sub-tab treatment.
    () => (selectedVariant === 'contrast' ? foreground : withAlpha(surfaceTertiary, 0.5)),
    [foreground, selectedVariant, surfaceTertiary]
  );
  const contentColor = contrast ? background : foreground;

  const rStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: isPressed.get() && !contrast ? pressedBg : 'rgba(0, 0, 0, 0)',
    };
  });

  return (
    <Log name="PillTabItem">
      <Pressable
        testID={testID}
        accessible
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={label}
        accessibilityState={
          accessibilityRole === 'radio'
            ? { checked: isActive, selected: isActive, ...(disabled ? { disabled } : {}) }
            : { selected: isActive, ...(disabled ? { disabled } : {}) }
        }
        accessibilityValue={
          accessibilityRole === 'radio' ? { text: isActive ? '1' : '0' } : undefined
        }
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
          {icon ? <Icon name={icon} size={18} color={contentColor} /> : null}
          <Text
            style={[
              styles.label,
              { color: disabled ? withAlpha(contentColor, 0.5) : contentColor },
            ]}>
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    </Log>
  );
}

type PillTabsProps<F extends string> = {
  tabs: readonly F[];
  activeTab: F;
  onTabChange: (tab: F) => void;
  /** Optional display label and leading icon, keeping tab values stable. */
  labelFor?: (tab: F) => string;
  iconFor?: (tab: F) => string | undefined;
  accessibilityRole?: 'tab' | 'radio';
  /** Stable per-pill accessibility identifier. */
  testIDFor?: (tab: F) => string | undefined;
  disabledFor?: (tab: F) => boolean;
  /** Extra pills rendered inline at the end of the same scrollable row. */
  trailing?: React.ReactElement | null;
  /** `'contrast'` paints the active pill like a primary button; see
   *  `CapsuleButton.selectedVariant`. Default `'tint'`. */
  selectedVariant?: 'tint' | 'contrast';
};

export function PillTabs<F extends string>({
  tabs,
  activeTab,
  onTabChange,
  testIDFor,
  disabledFor,
  labelFor,
  iconFor,
  accessibilityRole,
  trailing = null,
  selectedVariant = 'tint',
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
              label={labelFor?.(item) ?? item}
              icon={iconFor?.(item)}
              accessibilityRole={accessibilityRole}
              index={index}
              flatListRef={flatListRef}
              activeTab={activeTab}
              onTabChange={onTabChange}
              testID={testIDFor?.(item)}
              disabled={disabledFor?.(item)}
              selectedVariant={selectedVariant}
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
