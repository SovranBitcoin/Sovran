import { memo } from 'react';
import {
  Host,
  Button as SwiftUIButton,
  Menu,
  HStack as SwiftUIHStack,
  VStack as SwiftUIVStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, glassEffect, padding } from '@expo/ui/swift-ui/modifiers';
import { ActionSheetIOS, Platform, StyleSheet, Text } from 'react-native';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, radius, shadow, spacing, zIndex } from '@/shared/styles/tokens';
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
  const [foreground, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
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
              // Match the map's CircleActionButton (flat variant): same
              // surface-secondary fill + muted border, so the bottom card isn't
              // darker than the floating locate/zoom buttons.
              backgroundColor: surfaceSecondary,
              borderColor: opacity(muted, 0.3),
            },
          ]}>
          <Icon name="mdi:bitcoin" size={26} color={BITCOIN_ACCENT} />
          <View style={styles.fallbackText}>
            <Text style={[styles.fallbackTitle, { color: foreground }]} numberOfLines={1}>
              {visibleText}
            </Text>
            <Text
              style={[styles.fallbackSubtitle, { color: opacity(foreground, alpha.strong) }]}
              numberOfLines={1}>
              {totalText}
            </Text>
          </View>
          <Icon name="mdi:chevron-down" size={20} color={opacity(foreground, alpha.muted)} />
        </Pressable>
      </View>
    );
  }

  // `Menu` (not `ContextMenu`) so the glass capsule opens the category filter on
  // a single TAP. `ContextMenu` is hardcoded to long-press, which is why the
  // dropdown "did nothing" when tapped. Omitting `onPrimaryAction` means the tap
  // opens the menu (matching the proven FiatCurrencyPill.liquid pattern). The
  // glass effect + frame live on the Menu; the label is the trigger content.
  const glassCardModifiers = [
    frame({ width: cardWidth, height: 64, alignment: 'center' }),
    glassEffect({
      shape: 'capsule' as const,
      glass: { variant: 'regular' as const, interactive: true },
    }),
  ];

  return (
    <View style={styles.statsContainer}>
      <Host style={{ zIndex: zIndex.sticky, height: 64, width: cardWidth }} matchContents>
        <Menu
          modifiers={glassCardModifiers}
          label={
            <SwiftUIHStack
              alignment="center"
              spacing={12}
              modifiers={[
                frame({ maxWidth: Infinity, height: 64, alignment: 'leading' }),
                padding({ horizontal: 18 }),
              ]}>
              <SwiftUIImage systemName="bitcoinsign.circle.fill" size={24} color={BITCOIN_ACCENT} />
              {/* VStack takes the remaining width so the chevron sits at the
                  far right edge instead of crammed against the subtitle. */}
              <SwiftUIVStack
                alignment="leading"
                spacing={2}
                modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <SwiftUIText
                  modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle(foreground)]}>
                  {visibleText}
                </SwiftUIText>
                <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle(foreground)]}>
                  {totalText}
                </SwiftUIText>
              </SwiftUIVStack>
              <SwiftUIImage systemName="chevron.down" size={14} color={foreground} />
            </SwiftUIHStack>
          }>
          {CATEGORY_FILTERS.map((cat) => (
            <SwiftUIButton
              key={cat}
              label={`${categoryLabel(cat)}${cat === category ? ' ✓' : ''}`}
              onPress={() => onCategoryChange(cat)}
            />
          ))}
        </Menu>
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
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: 'black',
    ...shadow.md,
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
    marginTop: 1,
  },
});
