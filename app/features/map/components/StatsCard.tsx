import { memo } from 'react';
import { LiquidGlassMenu } from 'liquid-glass-menu';
import { ActionSheetIOS, Platform, StyleSheet, Text } from 'react-native';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { withAlpha } from '@/shared/lib/color';
import Icon from 'assets/icons';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, radius, shadow, spacing, fontSize } from '@/shared/styles/tokens';
import { useCapabilities } from '@/shared/ui/capability';
import { BITCOIN_ACCENT, INVARIANT_BLACK } from '@/shared/lib/brandColors';
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
  const [foreground, surfaceSecondary, muted, success] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
    'success',
  ] as const);
  const { liquidGlass } = useCapabilities();
  const colorScheme = useColorScheme();

  const visibleText = loading ? '...' : `${visibleCount.toLocaleString()} visible`;
  const totalText = loading
    ? 'Loading...'
    : `${totalCount.toLocaleString()} total • ${categoryLabel(category)}`;

  // The glass path needs the native UIKit glass-button morph; without it we fall
  // through to the flat card (which also covers Android and pre-iOS-26).
  if (!liquidGlass || !LiquidGlassMenu.isSupported) {
    const renderCard = (onPress: () => void) => (
      <View>
        <Pressable
          onPress={onPress}
          // The glass path above is a UIKit UIButton and is announced as a
          // button natively; this fallback covers Android + pre-iOS-26.
          accessibilityRole="button"
          style={[
            styles.fallbackCard,
            {
              width: cardWidth,
              // Match the map's CircleActionButton (flat variant): same
              // surface-secondary fill + muted border, so the bottom card isn't
              // darker than the floating locate/zoom buttons.
              backgroundColor: surfaceSecondary,
              borderColor: withAlpha(muted, 0.3),
            },
          ]}>
          <Icon name="mdi:bitcoin" size={26} color={BITCOIN_ACCENT} />
          <View style={styles.fallbackText}>
            <Text style={[styles.fallbackTitle, { color: foreground }]} numberOfLines={1}>
              {visibleText}
            </Text>
            <Text
              style={[styles.fallbackSubtitle, { color: withAlpha(foreground, alpha.strong) }]}
              numberOfLines={1}>
              {totalText}
            </Text>
          </View>
          <Icon name="mdi:chevron-down" size={20} color={withAlpha(foreground, alpha.muted)} />
        </Pressable>
      </View>
    );

    // iOS keeps the native ActionSheet — the card itself is the trigger.
    if (Platform.OS !== 'android') {
      return renderCard(() =>
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...CATEGORY_FILTERS.map(categoryLabel), 'Cancel'],
            cancelButtonIndex: CATEGORY_FILTERS.length,
          },
          (selectedIndex) => {
            const next = CATEGORY_FILTERS[selectedIndex];
            if (next) onCategoryChange(next);
          }
        )
      );
    }

    // Android: the app-wide `actionMenuPopup()` bottom sheet (rendered once by
    // <ActionMenuHost /> at the app root) — ActionSheetIOS doesn't exist here,
    // which used to leave this card a dead control. The global host opens fully
    // and stays hidden at rest, unlike an inline heroui sheet on Android.
    return renderCard(() =>
      actionMenuPopup({
        title: 'Merchant category',
        buttons: CATEGORY_FILTERS.map((cat) => ({
          text: categoryLabel(cat),
          suffix:
            cat === category ? <Icon name="mdi:check" size={20} color={success} /> : undefined,
          onPress: () => onCategoryChange(cat),
        })),
      })
    );
  }

  // Same native UIKit glass-button morph the wallet's FiatCurrencyPill uses, so
  // the map card animates as smoothly (a SwiftUI `glassEffect` Host felt buggy
  // by comparison). A single TAP opens the category menu and morphs the capsule;
  // the leading bitcoin icon + two-line label live inside the button itself.
  return (
    <View>
      <LiquidGlassMenu
        style={{ width: cardWidth, height: 64 }}
        image="bitcoinsign.circle.fill"
        imageColor={BITCOIN_ACCENT}
        label={visibleText}
        subtitle={totalText}
        labelColor={foreground}
        labelSize={18}
        contentAlignment="leading"
        colorScheme={colorScheme}
        menuTitle="Merchant category"
        actions={CATEGORY_FILTERS.map((cat) => ({
          id: cat,
          title: categoryLabel(cat),
          selected: cat === category,
        }))}
        onSelectAction={({ nativeEvent }) => onCategoryChange(nativeEvent.id as CategoryFilter)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fallbackCard: {
    minHeight: 60,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    shadowColor: INVARIANT_BLACK,
    ...shadow.md,
  },
  fallbackText: {
    flex: 1,
    minWidth: 0,
  },
  fallbackTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  fallbackSubtitle: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
});
