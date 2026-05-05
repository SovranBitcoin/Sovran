/**
 * AlbumPillTabs — horizontal album selector styled like MintCurrencyTabs
 * (rounded pills, selected-state surface-tertiary bg, scroll on overflow).
 * Used in the Background modal to filter the wallpaper grid by album.
 */

import React, { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
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
    [onSelect]
  );

  return (
    <Log name="AlbumPillTabs">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 16 }}>
        <View className="flex-row items-center gap-1.5">
          {tabs.map((tab) => {
            const isSelected = selectedTab === tab;
            return (
              <Pressable key={tab} onPress={() => handlePress(tab)} activeOpacity={0.7}>
                <View
                  className="rounded-2xl px-3.5 py-2"
                  style={{ backgroundColor: isSelected ? surfaceTertiary : surface }}>
                  <Text
                    style={{
                      fontFamily: 'OxygenBold',
                      fontSize: 14,
                      color: foreground,
                    }}>
                    {tab}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Log>
  );
}
