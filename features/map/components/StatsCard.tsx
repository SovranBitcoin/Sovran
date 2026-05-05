import { memo } from 'react';
import {
  Host,
  Button as SwiftUIButton,
  ContextMenu,
  HStack as SwiftUIHStack,
  VStack as SwiftUIVStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, glassEffect, padding } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { liquidGlassModifiers } from '@/shared/lib/version';
import { MERCHANT_CATEGORIES, type MerchantCategoryId } from '@/shared/lib/map/categories';
import { View } from '@/shared/ui/primitives/View/View';

export type CategoryFilter = 'all' | MerchantCategoryId;

const ALL_CATEGORY_LABEL = 'All Merchants';

export function categoryLabel(filter: CategoryFilter): string {
  if (filter === 'all') return ALL_CATEGORY_LABEL;
  return MERCHANT_CATEGORIES.find((c) => c.id === filter)?.label ?? filter;
}

export const CATEGORY_FILTERS: readonly CategoryFilter[] = [
  'all',
  ...MERCHANT_CATEGORIES.map((c) => c.id),
];

type StatsCardProps = {
  visibleCount: number;
  totalCount: number;
  loading: boolean;
  category: CategoryFilter;
  onCategoryChange: (cat: CategoryFilter) => void;
  cardWidth: number;
};

export const StatsCard = memo(function StatsCard({
  visibleCount,
  totalCount,
  loading,
  category,
  onCategoryChange,
  cardWidth,
}: StatsCardProps) {
  const foreground = useThemeColor('foreground');

  const visibleText = loading ? '...' : `${visibleCount.toLocaleString()} visible`;
  const totalText = loading
    ? 'Loading...'
    : `${totalCount.toLocaleString()} total • ${categoryLabel(category)}`;

  return (
    <View style={styles.statsContainer}>
      <Host style={{ zIndex: 10, height: 60, width: cardWidth }} matchContents>
        <ContextMenu>
          <ContextMenu.Items>
            {CATEGORY_FILTERS.map((cat) => (
              <SwiftUIButton
                key={cat}
                label={`${categoryLabel(cat)}${cat === category ? ' ✓' : ''}`}
                onPress={() => onCategoryChange(cat)}
              />
            ))}
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <SwiftUIHStack>
              <SwiftUIButton
                modifiers={[
                  frame({ width: cardWidth, height: 60, alignment: 'center' }),
                  ...liquidGlassModifiers(
                    glassEffect({
                      shape: 'capsule',
                      glass: { variant: 'regular', interactive: true },
                    })
                  ),
                ]}>
                <SwiftUIHStack
                  alignment="center"
                  spacing={12}
                  modifiers={[
                    frame({ maxWidth: Infinity, height: 60, alignment: 'leading' }),
                    padding({ horizontal: 16 }),
                  ]}>
                  <SwiftUIImage systemName="bitcoinsign.circle.fill" size={24} color="#F7931A" />
                  <SwiftUIVStack alignment="leading" spacing={2}>
                    <SwiftUIText
                      modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle(foreground)]}>
                      {visibleText}
                    </SwiftUIText>
                    <SwiftUIHStack alignment="center" spacing={4}>
                      <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle(foreground)]}>
                        {totalText}
                      </SwiftUIText>
                      <SwiftUIImage systemName="chevron.down" size={10} color={foreground} />
                    </SwiftUIHStack>
                  </SwiftUIVStack>
                </SwiftUIHStack>
              </SwiftUIButton>
            </SwiftUIHStack>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    </View>
  );
});

const styles = StyleSheet.create({
  statsContainer: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
  },
});
