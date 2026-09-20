/**
 * @fileoverview Animated Currency Tabs Component
 *
 * A horizontal tab bar for currency selection that animates between
 * large (expanded) and small (compact) sizes based on scroll position.
 */

import { accountUnitLabel, toRealUnit } from 'wallet';
import { useCallback } from 'react';
import { ScrollView } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import Icon, { CurrencyIcon } from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { cashuLog, Log } from '@/shared/lib/logger';
// Size constants
const LARGE_ICON_SIZE = 28;
const SMALL_ICON_SIZE = 22;
// The label stays one size in both states; only the icon, padding and gap
// animate with the collapse.
const FONT_SIZE = 14;
const LARGE_PADDING_H = 14;
const SMALL_PADDING_H = 12;
const LARGE_PADDING_V = 10;
const SMALL_PADDING_V = 8;
const LARGE_GAP = 8;
const SMALL_GAP = 4;
const COLLAPSE_THRESHOLD = 50;

/**
 * Fixed height of the tab strip (the resting / scroll-top LARGE size): a tab is
 * `LARGE_ICON_SIZE + 2×LARGE_PADDING_V` tall, plus the `pb-2` (8px) bottom space.
 *
 * The strip is pinned to this height so its `onLayout` measurement never changes
 * — neither from the scroll shrink-animation nor the tab count. Sticky-header
 * callers MUST declare this as `stickyContentHeight` so the list's reserved top
 * space matches the measured height from the first frame (no content shift).
 */
export const MINT_CURRENCY_TABS_HEIGHT = LARGE_ICON_SIZE + LARGE_PADDING_V * 2 + 8;

interface MintCurrencyTabsProps {
  /** Available currencies to show */
  currencies: string[];
  /** Currently selected currency */
  selectedCurrency: string;
  /** Callback when a currency is selected */
  onCurrencyChange: (currency: string) => void;
  /** Scroll position for animation (optional - if not provided, uses small size) */
  scrollY?: SharedValue<number>;
}

// Animated currency tab item
function AnimatedCurrencyTab({
  currency,
  isSelected,
  onPress,
  scrollY,
  primaryColor0,
  primaryColor700,
  primaryColor900,
}: {
  currency: string;
  isSelected: boolean;
  onPress: () => void;
  scrollY?: SharedValue<number>;
  primaryColor0: string;
  primaryColor700: string;
  primaryColor900: string;
}) {
  // Get label for currency
  // Testnut account units read tBTC / tUSD …; their icon is the real unit's.
  const label = currency === 'ALL' ? 'ALL' : accountUnitLabel(currency);
  const iconCurrency = toRealUnit(currency).toUpperCase();

  // Animated container style
  const animatedContainerStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        paddingHorizontal: SMALL_PADDING_H,
        paddingVertical: SMALL_PADDING_V,
      };
    }

    const paddingH = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_PADDING_H, SMALL_PADDING_H],
      Extrapolation.CLAMP
    );
    const paddingV = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_PADDING_V, SMALL_PADDING_V],
      Extrapolation.CLAMP
    );

    return {
      paddingHorizontal: paddingH,
      paddingVertical: paddingV,
    };
  });

  // Animated icon container - animates size for layout + scale for smooth visuals
  const animatedIconStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        width: SMALL_ICON_SIZE,
        height: SMALL_ICON_SIZE,
        transform: [{ scale: SMALL_ICON_SIZE / LARGE_ICON_SIZE }],
      };
    }

    const size = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_ICON_SIZE, SMALL_ICON_SIZE],
      Extrapolation.CLAMP
    );

    const scale = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [1, SMALL_ICON_SIZE / LARGE_ICON_SIZE],
      Extrapolation.CLAMP
    );

    return {
      width: size,
      height: size,
      transform: [{ scale }],
    };
  });

  // Animated gap style for the HStack
  const animatedGapStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        gap: SMALL_GAP,
      };
    }

    const gap = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_GAP, SMALL_GAP],
      Extrapolation.CLAMP
    );

    return {
      gap,
    };
  });

  // Render icon based on currency type - always render at LARGE size, scaling handles the rest
  const renderIcon = () => {
    if (iconCurrency === 'USD' || iconCurrency === 'EUR' || iconCurrency === 'GBP') {
      return (
        <Icon
          name={`circle-flags:${iconCurrency === 'USD' ? 'us' : iconCurrency === 'EUR' ? 'eu' : 'gb'}`}
          size={LARGE_ICON_SIZE}
        />
      );
    }
    if (currency === 'ALL') {
      return (
        <Icon
          name="clarity:internet-of-things-solid"
          color={primaryColor0}
          size={LARGE_ICON_SIZE}
        />
      );
    }
    return <CurrencyIcon width={LARGE_ICON_SIZE} currency={iconCurrency.toLowerCase()} />;
  };

  return (
    <Pressable
      testID={`mint-currency-tab-${currency}`}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      activeOpacity={0.7}>
      <Animated.View
        className="rounded-2xl"
        style={[
          { backgroundColor: isSelected ? primaryColor700 : primaryColor900 },
          animatedContainerStyle,
        ]}>
        <Animated.View className="flex-row items-center" style={animatedGapStyle}>
          <Animated.View className="items-center justify-center" style={animatedIconStyle}>
            {renderIcon()}
          </Animated.View>
          <Text size={FONT_SIZE} bold color={primaryColor0}>
            {label}
          </Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

export function MintCurrencyTabs({
  currencies,
  selectedCurrency,
  onCurrencyChange,
  scrollY,
}: MintCurrencyTabsProps) {
  const [primaryColor0, primaryColor700, primaryColor900] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface',
  ] as const);

  const handleCurrencyChange = useCallback(
    (currency: string) => {
      cashuLog.info('mint.currency.tab.select', { currency });
      onCurrencyChange(currency);
    },
    [onCurrencyChange]
  );

  // Animated gap between items
  const animatedListGapStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        gap: 6,
      };
    }

    const gap = interpolate(scrollY.value, [0, COLLAPSE_THRESHOLD], [10, 6], Extrapolation.CLAMP);

    return {
      gap,
    };
  });

  return (
    <Log name="MintCurrencyTabs">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="px-4 pb-2"
        // Pinned height — the tabs animate/shrink INSIDE this band on scroll, but
        // the band itself never re-measures, so the sticky header (and the list's
        // reserved top space) never shifts. See MINT_CURRENCY_TABS_HEIGHT.
        style={{ height: MINT_CURRENCY_TABS_HEIGHT }}
        contentContainerClassName="items-center">
        <Animated.View className="flex-row items-center" style={animatedListGapStyle}>
          {currencies.map((currency) => (
            <AnimatedCurrencyTab
              key={currency}
              currency={currency}
              isSelected={selectedCurrency === currency}
              onPress={() => handleCurrencyChange(currency)}
              scrollY={scrollY}
              primaryColor0={primaryColor0}
              primaryColor700={primaryColor700}
              primaryColor900={primaryColor900}
            />
          ))}
        </Animated.View>
      </ScrollView>
    </Log>
  );
}
