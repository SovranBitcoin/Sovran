/**
 * @fileoverview `ListRow` — unified list-row primitive for contacts, mints,
 * peers, geohashes, location tiers, and anything else that wants the same
 * visual rhythm.
 *
 * Before this primitive: every list row reimplemented the same 20/12 padding,
 * 12-gap, 16/600 title, 14/0.5-opacity subtitle layout independently. Four
 * components, four flavours of drift. This collapses them.
 *
 * Shape:  [leading] [title / subtitle / accent?] [trailing]
 *
 *   • leading  — one of { avatar, iconCircle, custom ReactNode }
 *   • title    — string or ReactNode  (string → 16/600, single line, ellipsize)
 *   • subtitle — string or ReactNode  (string → 14 @ 0.5 opacity, single line)
 *   • accent   — ReactNode rendered as a third line (stats row, etc.)
 *   • trailing — any ReactNode (chevron, icon, checkbox, spinner, amount…)
 *
 * Padding follows the app-wide convention: paddingHorizontal 20, paddingVertical
 * 12, row gap 12. `padding="compact"` drops the vertical to 8 for denser lists.
 */

import React, { ReactNode } from 'react';
import { Pressable, View, StyleProp, ViewStyle, StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';

// ---------------------------------------------------------------------------

export interface ListRowAvatar {
  picture?: string;
  seed?: string;
  name?: string;
  size?: 40 | 44;
  loading?: boolean;
}

export interface ListRowIconCircle {
  icon: string;
  color: string;
  size?: 40 | 44;
  backgroundColor?: string;
}

export interface ListRowProps {
  /** Leading slot — pick exactly one. `leading` takes priority as the escape hatch. */
  avatar?: ListRowAvatar;
  iconCircle?: ListRowIconCircle;
  leading?: ReactNode;

  /** Primary line. String → 16/600 ellipsize. ReactNode → caller owns layout. */
  title: string | ReactNode;

  /** Secondary line. String → 14 @ 0.5 opacity ellipsize. */
  subtitle?: string | ReactNode;

  /** Optional third line — stats rows, inline amounts, etc. */
  accent?: ReactNode;

  /** Trailing slot — chevron, icon, checkbox, spinner, button. */
  trailing?: ReactNode;

  onPress?: () => void;
  disabled?: boolean;
  /** When true, render skeleton placeholders for string title/subtitle. */
  loading?: boolean;
  /** Title placeholder text (invisible) that sizes the skeleton. Defaults to a generic label. */
  titlePlaceholder?: string;
  /** Subtitle placeholder text for skeleton sizing. */
  subtitlePlaceholder?: string;

  testID?: string;

  /** Default: `paddingHorizontal: 20, paddingVertical: 12`. Compact: pv 8. */
  padding?: 'default' | 'compact';

  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------

// All leading elements default to 44 px so Avatar, IconCircle, and any custom
// leading sit at the same visual weight — consistency was the whole point of
// this primitive. Callers that genuinely need a denser variant can still pass
// `size: 40`, but the default on all rows matches the `ContactListItem` spec.
const DEFAULT_AVATAR_SIZE = 44;
const DEFAULT_ICON_CIRCLE_SIZE = 44;
const ROW_GAP = 12;

export function ListRow({
  avatar,
  iconCircle,
  leading,
  title,
  subtitle,
  accent,
  trailing,
  onPress,
  disabled = false,
  loading = false,
  titlePlaceholder = 'Display name',
  subtitlePlaceholder = 'Secondary line',
  testID,
  padding = 'default',
  style,
}: ListRowProps) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const paddingVertical = padding === 'compact' ? 8 : 12;

  // ----- Leading resolution (priority: custom leading > iconCircle > avatar) -----

  let leadingEl: ReactNode = null;
  if (leading != null) {
    leadingEl = leading;
  } else if (iconCircle) {
    const size = iconCircle.size ?? DEFAULT_ICON_CIRCLE_SIZE;
    const iconSize = Math.round(size * 0.45);
    leadingEl = (
      <View
        style={[
          styles.iconCircle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: iconCircle.backgroundColor ?? opacity(iconCircle.color, 0.12),
          },
        ]}>
        <Icon name={iconCircle.icon} size={iconSize} color={iconCircle.color} />
      </View>
    );
  } else if (avatar) {
    leadingEl = (
      <Avatar
        picture={avatar.picture}
        seed={avatar.seed}
        name={avatar.name}
        size={avatar.size ?? DEFAULT_AVATAR_SIZE}
        loading={avatar.loading ?? loading}
      />
    );
  }

  // ----- Title / subtitle rendering — strings get default styling, ReactNode is passthrough -----

  const titleEl =
    typeof title === 'string' ? (
      <Text
        size={16}
        bold
        numberOfLines={1}
        color={foreground}
        loading={loading}
        placeholder={titlePlaceholder}>
        {title}
      </Text>
    ) : (
      title
    );

  const subtitleEl =
    subtitle == null
      ? null
      : typeof subtitle === 'string'
        ? (
          <Text
            size={14}
            numberOfLines={1}
            color={opacity(foreground, 0.5)}
            loading={loading}
            placeholder={subtitlePlaceholder}>
            {subtitle}
          </Text>
        )
        : subtitle;

  // ----- Row content -----

  const body = (
    <HStack align="center" style={{ paddingHorizontal: 20, paddingVertical, gap: ROW_GAP }}>
      {leadingEl}
      <VStack style={styles.textCol} spacing={2}>
        {titleEl}
        {subtitleEl}
        {accent}
      </VStack>
      {trailing}
    </HStack>
  );

  // ----- Pressable wrapper (only if onPress), disabled dim, press-feedback -----

  if (!onPress) {
    return (
      <View testID={testID} style={[disabled && styles.disabled, style]}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        pressed && { backgroundColor: surfaceSecondary },
        disabled && styles.disabled,
        style,
      ]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
  },
  disabled: {
    opacity: 0.5,
  },
});
