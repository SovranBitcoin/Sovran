import React from 'react';
import { StyleSheet } from 'react-native';
import { Log } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface UnderlineTabsProps {
  tabs: readonly string[];
  selectedTab: string;
  handleTabPress: (tab: string, index: number) => void;
  /** Override the active underline color. Defaults to the theme `accent` token. */
  accentColor?: string;
}

/**
 * Flat underline tab bar — each tab is `flex: 1`, the active tab gets a
 * 2 px bottom border in `accent` and a heavier weight; inactive labels use
 * the theme `muted` token. Mirrors the top-tab pattern on `ContactsScreen`
 * so screens that opt for the underline style render byte-identical chrome.
 */
export function UnderlineTabs({
  tabs,
  selectedTab,
  handleTabPress,
  accentColor,
}: UnderlineTabsProps) {
  const [foreground, muted, themeAccent] = useThemeColor([
    'foreground',
    'muted',
    'accent',
  ] as const);
  const underline = accentColor ?? themeAccent;

  return (
    <Log name="UnderlineTabs">
      <View style={styles.row}>
        {tabs.map((tab, index) => {
          const isActive = selectedTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => handleTabPress(tab, index)}
              style={[
                styles.tab,
                isActive && { borderBottomColor: underline, borderBottomWidth: 2 },
              ]}>
              <Text size={16} bold={isActive} color={isActive ? foreground : muted}>
                {tab}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
});
