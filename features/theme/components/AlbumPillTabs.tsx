/**
 * AlbumPillTabs — horizontal album selector styled like MintCurrencyTabs
 * (rounded pills, selected-state surface-tertiary bg, scroll on overflow).
 * Used in the Background modal to filter the wallpaper grid by album.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, log } from '@/shared/lib/logger';

interface AlbumPillTabsProps {
  tabs: string[];
  selectedTab: string;
  onSelect: (tab: string) => void;
}

export function AlbumPillTabs({ tabs, selectedTab, onSelect }: AlbumPillTabsProps) {
  const [foreground, surfaceTertiary, surface] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface',
  ] as const);

  const handlePress = useCallback(
    (tab: string) => {
      log.info('theme.background.album.tab', { album: tab });
      onSelect(tab);
    },
    [onSelect],
  );

  return (
    <Log name="AlbumPillTabs">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}>
        <View style={styles.row}>
          {tabs.map((tab) => {
            const isSelected = selectedTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => handlePress(tab)}
                activeOpacity={0.7}>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: isSelected ? surfaceTertiary : surface },
                  ]}>
                  <Text
                    style={{
                      fontFamily: 'OxygenBold',
                      fontSize: 14,
                      color: foreground,
                    }}>
                    {tab}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </Log>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
});
