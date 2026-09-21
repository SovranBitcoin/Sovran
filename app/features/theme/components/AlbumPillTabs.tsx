/**
 * AlbumPillTabs — horizontal album selector styled like MintCurrencyTabs
 * (rounded pills, selected-state surface-tertiary bg, scroll on overflow).
 * Used in the Background modal to filter the wallpaper grid by album.
 */

import { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, log } from '@/shared/lib/logger';

interface AlbumPillTabsProps {
  tabs: readonly { slug: string; label: string }[];
  selectedSlug: string;
  onSelect: (slug: string) => void;
}

export function AlbumPillTabs({ tabs, selectedSlug, onSelect }: AlbumPillTabsProps) {
  const [foreground, surfaceTertiary, surface] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface',
  ] as const);

  const handlePress = useCallback(
    (slug: string) => {
      log.info('theme.background.album.tab', { album: slug });
      onSelect(slug);
    },
    [onSelect]
  );

  return (
    <Log name="AlbumPillTabs">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="items-center px-4">
        <View className="flex-row items-center gap-1.5">
          {tabs.map(({ slug, label }) => {
            const isSelected = selectedSlug === slug;
            return (
              <Pressable
                key={slug}
                onPress={() => handlePress(slug)}
                activeOpacity={0.7}
                testID={`background-album-tab-${slug}`}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}>
                <View
                  className="rounded-2xl px-3.5 py-2"
                  style={{ backgroundColor: isSelected ? surfaceTertiary : surface }}>
                  <Text bold size={14} color={foreground}>
                    {label}
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
