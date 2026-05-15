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
import { ActionSheetIOS, Platform, StyleSheet, Text } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';
import { useCapabilities } from '@/shared/ui/capability';
import { BITCOIN_ACCENT } from '@/shared/lib/brandColors';
import { MERCHANT_CATEGORIES, type MerchantCategoryId } from '@/shared/lib/map/categories';
import { View } from '@/shared/ui/primitives/View/View';
import { Pressable } from '@/shared/ui/primitives/Pressable';

export type CategoryFilter = 'all' | MerchantCategoryId;

const ALL_CATEGORY_LABEL = 'All Merchants';

function categoryLabel(filter: CategoryFilter): string {
  if (filter === 'all') return ALL_CATEGORY_LABEL;
  return MERCHANT_CATEGORIES.find((c) => c.id === filter)?.label ?? filter;
}

const CATEGORY_FILTERS: readonly CategoryFilter[] = [
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
  const { liquidGlass } = useCapabilities();

  const visibleText = loading ? '...' : `${visibleCount.toLocaleString()} visible`;
  const totalText = loading
    ? 'Loading...'
    : `${totalCount.toLocaleString()} total • ${categoryLabel(category)}`;

  if (!liquidGlass) {
    const handlePress = () => {
      if (Platform.OS !== 'ios') return;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...CATEGORY_FILTERS.map(categoryLabel), 'Cancel'],
          cancelButtonIndex: CATEGORY_FILTERS.length,
        },
        (selectedIndex) => {
          const next = CATEGORY_FILTERS[selectedIndex];
          if (next) onCategoryChange(next);
        }
      );
    };

    return (
      <View style={styles.statsContainer}>
        <Pressable
          onPress={handlePress}
          style={[
            styles.fallbackCard,
            {
              width: cardWidth,
              borderColor: `${foreground}1F`,
            },
          ]}>
          <Text style={[styles.fallbackIcon, { color: BITCOIN_ACCENT }]}>B</Text>
          <View style={styles.fallbackText}>
            <Text style={[styles.fallbackTitle, { color: foreground }]}>{visibleText}</Text>
            <Text style={[styles.fallbackSubtitle, { color: foreground }]} numberOfLines={1}>
              {totalText}
            </Text>
          </View>
          <Text style={[styles.fallbackChevron, { color: foreground }]}>v</Text>
        </Pressable>
      </View>
    );
  }

  const glassCardModifiers = [
    glassEffect({
      shape: 'capsule' as const,
      glass: { variant: 'regular' as const, interactive: true },
    }),
  ];

  return (
    <View style={styles.statsContainer}>
      <Host style={{ zIndex: zIndex.sticky, height: 60, width: cardWidth }} matchContents>
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
                  ...glassCardModifiers,
                ]}>
                <SwiftUIHStack
                  alignment="center"
                  spacing={12}
                  modifiers={[
                    frame({ maxWidth: Infinity, height: 60, alignment: 'leading' }),
                    padding({ horizontal: 16 }),
                  ]}>
                  <SwiftUIImage
                    systemName="bitcoinsign.circle.fill"
                    size={24}
                    color={BITCOIN_ACCENT}
                  />
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
  fallbackCard: {
    minHeight: 60,
    borderRadius: 30,
    borderWidth: 1,
    backgroundColor: 'rgba(20, 20, 20, 0.72)',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fallbackIcon: {
    fontSize: 20,
    fontWeight: '800',
  },
  fallbackText: {
    flex: 1,
    minWidth: 0,
  },
  fallbackTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  fallbackSubtitle: {
    fontSize: 12,
    opacity: 0.8,
  },
  fallbackChevron: {
    fontSize: 12,
    opacity: 0.75,
  },
});
