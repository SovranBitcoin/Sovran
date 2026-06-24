import { useRef } from 'react';
import { LiquidGlassMenu } from 'liquid-glass-menu';
import { Menu as HeroMenu, type MenuTriggerRef } from 'heroui-native';
import { ActionSheetIOS, Platform, StyleSheet, Text } from 'react-native';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, radius, shadow, spacing, fontSize } from '@/shared/styles/tokens';
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

export const StatsCard = function StatsCard({
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
  const menuTriggerRef = useRef<MenuTriggerRef>(null);
  const openCategoryMenu = () => {
    setTimeout(() => menuTriggerRef.current?.open(), 0);
  };

  const visibleText = loading ? '...' : `${visibleCount.toLocaleString()} visible`;
  const totalText = loading
    ? 'Loading...'
    : `${totalCount.toLocaleString()} total • ${categoryLabel(category)}`;

  // The glass path needs the native UIKit glass-button morph; without it we fall
  // through to the flat card (which also covers Android and pre-iOS-26).
  if (!liquidGlass || !LiquidGlassMenu.isSupported) {
    const handlePress = () => {
      if (Platform.OS !== 'ios') {
        // Android: heroui Menu bottom sheet (the canonical pick-one-of-N
        // surface) — ActionSheetIOS doesn't exist here, which used to leave
        // this card a dead control.
        openCategoryMenu();
        return;
      }

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

    const card = (
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

    if (Platform.OS !== 'android') {
      return card;
    }

    return (
      <HeroMenu presentation="bottom-sheet">
        <HeroMenu.Trigger
          ref={menuTriggerRef}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          <View style={{ width: 1, height: 1 }} />
        </HeroMenu.Trigger>
        {card}
        <HeroMenu.Portal disableFullWindowOverlay>
          <MenuScrim />
          <HeroMenu.Content presentation="bottom-sheet">
            <HeroMenu.Label className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
              Merchant category
            </HeroMenu.Label>
            {CATEGORY_FILTERS.map((cat) => (
              <HeroMenu.Item key={cat} onPress={() => onCategoryChange(cat)}>
                <HStack align="center" gap={10} style={{ flex: 1 }}>
                  <View style={{ flex: 1 }}>
                    <HeroMenu.ItemTitle>{categoryLabel(cat)}</HeroMenu.ItemTitle>
                  </View>
                  {cat === category ? <Icon name="mdi:check" size={20} color={success} /> : null}
                </HStack>
              </HeroMenu.Item>
            ))}
          </HeroMenu.Content>
        </HeroMenu.Portal>
      </HeroMenu>
    );
  }

  // Same native UIKit glass-button morph the wallet's FiatCurrencyPill uses, so
  // the map card animates as smoothly (a SwiftUI `glassEffect` Host felt buggy
  // by comparison). A single TAP opens the category menu and morphs the capsule;
  // the leading bitcoin icon + two-line label live inside the button itself.
  return (
    <View style={styles.statsContainer}>
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
};

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
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  fallbackSubtitle: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
});
