import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';

export interface BalanceDisplayProps {
  /** Top-row label (e.g. mint name, "Balance"). */
  title?: string;
  /** Current balance amount in `unit`. */
  balance: number;
  /** Currency unit for `<AmountFormatter />`. Default `'sat'`. */
  unit?: string;
  /** Skeletonizes the title + amount + leading avatar. */
  isLoading?: boolean;
  /**
   * Replaces the title + amount stack with a single CTA line when set
   * (e.g. "Top up balance" for the AI header when the user has no Routstr
   * balance yet). Pill chrome / icon / chevron are unchanged so tapping
   * still routes to the host's `onPress`. Takes precedence over `title`
   * + `balance`; ignored while `isLoading`.
   */
  ctaLabel?: string;
  /**
   * Custom leading glyph node. Takes precedence over `iconUrl`. Use this to
   * render a flat iconify glyph instead of an avatar (the AI tab passes a
   * wallet icon here; the wallet tab passes nothing and falls back to the
   * mint avatar below).
   */
  iconNode?: React.ReactNode;
  /** Image URL for the avatar (falls back to initials of `iconFallbackName`). */
  iconUrl?: string;
  contentWidth?: number;
  contentHeight?: number;
  /** Override the square wrapper around `iconNode` / Avatar. Defaults to
   *  32 — matches the wallet-header pill. Pass a smaller value for
   *  compact pills where the glyph should sit snug against the row
   *  instead of floating in a big centered box. */
  iconBoxSize?: number;
  /** Override the gap between the icon and the title/CTA text. Defaults
   *  to 4 (matches the header pill's `mr-1`). */
  iconRightSpacing?: number;
  /** Holds the skeleton → label fade at one frame (0 skeleton, 1 label), for
   *  a design-system scrubber. Omitted, the fade follows `isLoading`. */
  loadingProgress?: SharedValue<number>;
  /** BTC/sats display preference for the amount, in place of the saved
   *  setting: fixtures pass one so they draw the same whatever it is. */
  displayPreference?: number;
  style?: StyleProp<ViewStyle>;
}

/** One skeleton bar the height of a 12pt label line, so bars and label share a box. */
function SkeletonLine({ width, still }: { width: string; still: boolean }) {
  return (
    <View>
      <Text size={12} bold accessible={false} className="opacity-0">
        {' '}
      </Text>
      <Skeleton static={still} className={`absolute bottom-0.5 left-0 top-0.5 rounded ${width}`} />
    </View>
  );
}

/**
 * Inner display for `<BalancePill />`: leading icon (avatar or custom glyph)
 * + stacked title / amount + trailing chevron. Same visual layout the
 * wallet's mint header has shipped with — generalized here so the AI tab
 * can mount the identical chrome with a wallet icon and "Balance" label
 * instead of a mint logo and mint name.
 */
const BalanceDisplay: React.FC<BalanceDisplayProps> = ({
  title,
  balance,
  unit = 'sat',
  isLoading = false,
  ctaLabel,
  iconNode,
  iconUrl,
  contentWidth,
  contentHeight,
  iconBoxSize = 32,
  iconRightSpacing = 4,
  loadingProgress,
  displayPreference,
  style,
}) => {
  const foreground = useThemeColor('foreground');

  const innerHeight = contentHeight ?? 36;
  const innerWidth = contentWidth;

  // CTA mode wins only when we have actual data to render — while loading
  // we still want the skeleton, otherwise the pill flicks from "Top up
  // balance" to the real balance the moment the fetch lands.
  const showCta = !isLoading && ctaLabel != null;
  const iconBoxStyle = { width: iconBoxSize, height: iconBoxSize };
  const iconSlotStyle = { marginRight: iconRightSpacing };
  // Placeholder, balance and call-to-action rows share one minimum height,
  // so swapping between them (into "Add a mint") moves nothing vertically.
  const rowStyle = { minHeight: innerHeight };
  // A frame held by the scrubber must not pulse.
  const still = loadingProgress !== undefined;

  return (
    <Log name="BalanceDisplay">
      <HStack
        align="center"
        justify="space-between"
        style={[{ height: innerHeight, width: innerWidth }, style]}>
        {/* The label column takes what the icon and chevron leave and no more,
            so a long mint name ends in an ellipsis inside the pill. Loading
            draws fixed bars in the same box, then fades them over the label,
            so nothing in the pill moves when the mint arrives. */}
        <View className="min-w-0 flex-1">
          <SkeletonContentCrossfade
            loading={isLoading}
            wave="none"
            crossfadeContent
            progressOverride={loadingProgress}
            visualKey="balance-display"
            visualComponent="BalanceDisplay"
            renderSkeleton={() => (
              <View
                className="flex-row items-center"
                style={rowStyle}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                <View style={iconSlotStyle}>
                  <Skeleton static={still} className="rounded-full" style={iconBoxStyle} />
                </View>
                <View>
                  <SkeletonLine width="w-[88px]" still={still} />
                  <SkeletonLine width="w-[56px]" still={still} />
                </View>
              </View>
            )}
            renderContent={() => (
              <View className="min-w-0 flex-row items-center" style={rowStyle}>
                <View style={iconSlotStyle}>
                  {iconNode ? (
                    // Square box around the glyph — defaults to 32 to keep
                    // spacing identical to the avatar-driven variant. Compact
                    // pills override via `iconBoxSize` so the glyph sits snug
                    // against the row instead of floating in a big centered
                    // box.
                    <View className="items-center justify-center" style={iconBoxStyle}>
                      {iconNode}
                    </View>
                  ) : (
                    <Avatar
                      state={iconUrl ? 'image' : 'fallback'}
                      picture={iconUrl}
                      size={iconBoxSize}
                      name={title}
                      alt={`${title || 'Balance'} icon`}
                    />
                  )}
                </View>
                {showCta ? (
                  // Single-line CTA replaces the title+amount stack. Vertically
                  // centered inside the same pill so the header doesn't reflow
                  // when the user tops up and the layout swaps back to the
                  // standard two-line balance row.
                  <Text
                    size={14}
                    bold
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    className="min-w-0 shrink"
                    color={foreground}>
                    {ctaLabel}
                  </Text>
                ) : (
                  <View className="min-w-0 shrink items-start">
                    <Text color={foreground} size={12} numberOfLines={1} ellipsizeMode="tail" bold>
                      {title || undefined}
                    </Text>
                    <AmountFormatter
                      className="ml-1"
                      size={12}
                      weight="heavy"
                      amount={balance}
                      unit={unit}
                      displayPreference={displayPreference}
                    />
                  </View>
                )}
              </View>
            )}
          />
        </View>

        <View className="ml-1 mr-2">
          <Icon name="fluent:chevron-down-12-filled" size={12} color={foreground} />
        </View>
      </HStack>
    </Log>
  );
};

export default BalanceDisplay;
