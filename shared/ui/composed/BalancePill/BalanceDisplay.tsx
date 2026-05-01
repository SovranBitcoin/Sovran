import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';

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
  /** Initials seed when no `iconUrl` is available. */
  iconFallbackName?: string;
  /** Skeleton placeholder text used by the title slot. */
  loadingTitlePlaceholder?: string;
  contentWidth?: number;
  contentHeight?: number;
  style?: StyleProp<ViewStyle>;
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
  iconFallbackName,
  loadingTitlePlaceholder = 'Title',
  contentWidth,
  contentHeight,
  style,
}) => {
  const foreground = useThemeColor('foreground');

  const innerHeight = contentHeight ?? 36;
  const innerWidth = contentWidth;

  // CTA mode wins only when we have actual data to render — while loading
  // we still want the skeleton, otherwise the pill flicks from "Top up
  // balance" to the real balance the moment the fetch lands.
  const showCta = !isLoading && ctaLabel != null;

  return (
    <Log name="BalanceDisplay">
      <HStack
        align="center"
        justify="space-between"
        style={[{ height: innerHeight, width: innerWidth }, style]}>
        <HStack align="center">
          <View className="mr-1">
            {iconNode ? (
              // 32x32 box keeps spacing identical to the avatar-driven
              // variant so swapping doesn't shift the rest of the row.
              <View
                style={{
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                {iconNode}
              </View>
            ) : (
              <Avatar
                state={isLoading ? 'loading' : iconUrl ? 'image' : 'fallback'}
                picture={iconUrl}
                size={32}
                name={iconFallbackName ?? title}
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
              style={{ color: foreground }}>
              {ctaLabel}
            </Text>
          ) : (
            <VStack align="flex-start">
              <Text
                loading={isLoading}
                placeholder={loadingTitlePlaceholder}
                style={{ color: foreground }}
                size={12}
                bold>
                {isLoading ? undefined : title || undefined}
              </Text>
              {isLoading ? (
                <Text loading placeholder="1,000 sats" size={12} bold>
                  {undefined}
                </Text>
              ) : (
                <AmountFormatter
                  className="ml-1"
                  size={12}
                  weight="heavy"
                  amount={balance}
                  unit={unit}
                />
              )}
            </VStack>
          )}
        </HStack>

        <View className="mr-2">
          <Icon name="fluent:chevron-down-12-filled" size={12} color={foreground} />
        </View>
      </HStack>
    </Log>
  );
};

export default BalanceDisplay;
