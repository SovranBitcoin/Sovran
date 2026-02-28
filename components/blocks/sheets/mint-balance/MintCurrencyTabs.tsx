/**
 * @fileoverview Animated Currency Tabs Component
 *
 * A horizontal tab bar for currency selection that animates between
 * large (expanded) and small (compact) sizes based on scroll position.
 */

import React, { useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  SharedValue,
} from 'react-native-reanimated';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon, { CurrencyIcon } from 'assets/icons';
import { useThemeColor } from 'hooks/useThemeColor';
// Size constants
const LARGE_ICON_SIZE = 28;
const SMALL_ICON_SIZE = 22;
const LARGE_FONT_SIZE = 14;
const SMALL_FONT_SIZE = 14;
const LARGE_PADDING_H = 14;
const SMALL_PADDING_H = 12;
const LARGE_PADDING_V = 10;
const SMALL_PADDING_V = 8;
const LARGE_GAP = 8;
const SMALL_GAP = 4;
const COLLAPSE_THRESHOLD = 50;

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
  const label = currency === 'SAT' ? 'BTC' : currency === 'ALL' ? 'ALL' : currency;

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

  // Animated text style
  const animatedTextStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return {
        fontSize: SMALL_FONT_SIZE,
      };
    }

    const fontSize = interpolate(
      scrollY.value,
      [0, COLLAPSE_THRESHOLD],
      [LARGE_FONT_SIZE, SMALL_FONT_SIZE],
      Extrapolation.CLAMP
    );

    return {
      fontSize,
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
    if (currency === 'USD' || currency === 'EUR' || currency === 'GBP') {
      return (
        <Icon
          name={`circle-flags:${currency === 'USD' ? 'us' : currency === 'EUR' ? 'eu' : 'gb'}`}
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
    return <CurrencyIcon width={LARGE_ICON_SIZE} currency={currency.toLowerCase()} />;
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Animated.View
        style={[
          styles.tabContainer,
          { backgroundColor: isSelected ? primaryColor700 : primaryColor900 },
          animatedContainerStyle,
        ]}>
        <Animated.View style={[styles.tabContent, animatedGapStyle]}>
          <Animated.View style={[styles.iconContainer, animatedIconStyle]}>
            {renderIcon()}
          </Animated.View>
          <Animated.Text style={[styles.tabText, { color: primaryColor0 }, animatedTextStyle]}>
            {label}
          </Animated.Text>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export function MintCurrencyTabs({
  currencies,
  selectedCurrency,
  onCurrencyChange,
  scrollY,
}: MintCurrencyTabsProps) {
  const [primaryColor0, primaryColor700, primaryColor900] = useThemeColor(['foreground', 'surface-tertiary', 'surface'] as const);

  const handleCurrencyChange = useCallback(
    (currency: string) => {
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}>
      <Animated.View style={[styles.tabList, animatedListGapStyle]}>
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
  );
}

const styles = StyleSheet.create({
  scrollView: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scrollContent: {
    alignItems: 'center',
  },
  tabList: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabContainer: {
    borderRadius: 16,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontFamily: 'OverpassBold',
  },
});
