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
 *   • subtitle — string or ReactNode  (string → 14 @ 0.5 opacity, single line by default)
 *   • accent   — ReactNode rendered as a third line (stats row, etc.)
 *   • trailing — any ReactNode (chevron, icon, checkbox, spinner, amount…)
 *
 * Padding follows the app-wide convention: paddingHorizontal 20, paddingVertical
 * 12, row gap 12. `padding="compact"` drops the vertical to 8 for denser lists.
 */

import React, { ReactNode } from 'react';
import { View, StyleProp, ViewStyle, StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import { useSingleFlight } from '@/shared/hooks/useSingleFlight';

import { Avatar, AvatarState } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';

// ---------------------------------------------------------------------------

export interface ListRowAvatar {
  /** Explicit avatar state. When omitted, ListRow derives it from the row-level
   *  `loading` prop and the presence of `picture`. */
  state?: AvatarState;
  picture?: string;
  seed?: string;
  name?: string;
  size?: 40 | 44 | 52;
}

export interface ListRowIconCircle {
  icon: string;
  color: string;
  size?: 40 | 44 | 52;
  backgroundColor?: string;
}

/** Plain leading icon — no circle chrome, settings-row style. */
interface ListRowIcon {
  name: string;
  /** Defaults to the foreground theme color. */
  color?: string;
  /** Glyph size. @default 22 */
  size?: number;
}

interface ListRowProps {
  /** Leading slot — pick exactly one. `leading` takes priority as the escape hatch. */
  avatar?: ListRowAvatar;
  iconCircle?: ListRowIconCircle;
  /** Plain icon, no circle — for action rows inside ListGroup containers. */
  icon?: ListRowIcon;
  leading?: ReactNode;

  /** Primary line. String → 16/600 ellipsize. ReactNode → caller owns layout.
   *  May be nullish when `titleFallback` is provided (so Text can render the
   *  fallback). */
  title?: string | ReactNode;

  /** Secondary line. String → 14 @ 0.5 opacity. */
  subtitle?: string | ReactNode;
  /** Allow string subtitles to wrap instead of ellipsizing to one line. */
  wrapSubtitle?: boolean;

  /** Optional third line — stats rows, inline amounts, etc. */
  accent?: ReactNode;

  /**
   * Where the `accent` slot renders relative to the main row.
   *   - `'inline'` (default) — third line inside the text column, sharing
   *     vertical center with leading + trailing.
   *   - `'below'` — accent moves out of the text column into a sibling row
   *     beneath the main HStack, indented past the leading width so the
   *     leading + trailing slots can align with just the title + subtitle
   *     band. Used by the Select Mint row where stats sit visually
   *     decoupled from the avatar / inspect button.
   */
  accentPosition?: 'inline' | 'below';

  /** Trailing slot — chevron, icon, checkbox, spinner, button. */
  trailing?: ReactNode;

  onPress?: () => void;
  disabled?: boolean;
  /** When true, render loading placeholders for string title/subtitle. */
  loading?: boolean;
  /** Title placeholder text (invisible) that sizes the loading bar. Defaults to a generic label. */
  titlePlaceholder?: string;
  /** Subtitle placeholder text for loading-bar sizing. */
  subtitlePlaceholder?: string;
  /** Fallback rendered in the title slot when title is nullish and not loading. */
  titleFallback?: ReactNode;
  /** Fallback rendered in the subtitle slot when subtitle is nullish and not loading. */
  subtitleFallback?: ReactNode;

  testID?: string;

  /** Default: `paddingHorizontal: 20, paddingVertical: 12`. Compact: pv 8. */
  padding?: 'default' | 'compact';

  /**
   * Horizontal inset of the row content. Defaults to the app-wide 20; pass 16
   * when the row sits beside heroui `ListGroup.Item` siblings (p-4 = 16) so
   * adjacent groups align. NOTE: the `style` prop lands on the OUTER wrapper —
   * padding there stacks on top of this inset instead of replacing it.
   */
  paddingHorizontal?: number;

  style?: StyleProp<ViewStyle>;

  /** VoiceOver/TalkBack label for the row. Defaults to `title` when `title`
   *  is a string. Required for rows whose title is a ReactNode. */
  accessibilityLabel?: string;
  /** Optional VoiceOver hint describing the row's tap outcome. */
  accessibilityHint?: string;
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
  icon,
  leading,
  title,
  subtitle,
  accent,
  accentPosition = 'inline',
  trailing,
  onPress,
  disabled = false,
  loading = false,
  titlePlaceholder = 'Display name',
  subtitlePlaceholder = 'Secondary line',
  titleFallback,
  subtitleFallback,
  wrapSubtitle = false,
  testID,
  padding = 'default',
  paddingHorizontal = 20,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ListRowProps) {
  const foreground = useThemeColor('foreground');

  // Same double-tap guard the project Pressable provided before the press
  // surface moved to heroui PressableFeedback — rows routinely await payment
  // actions, so a rapid second tap must drop synchronously.
  const guardedPress = useSingleFlight(async () => {
    if (!onPress) return;
    const result = onPress() as unknown;
    if (result instanceof Promise) await result;
  });

  const paddingVertical = padding === 'compact' ? 8 : 12;

  // ----- Leading resolution (priority: leading > icon > iconCircle > avatar) -----

  let leadingEl: ReactNode = null;
  if (leading != null) {
    leadingEl = leading;
  } else if (icon) {
    // Fixed-width slot keeps titles aligned across rows whose glyphs differ
    // in visual width; centered so the 12px row gap reads consistently.
    const iconSize = icon.size ?? 22;
    leadingEl = (
      <View style={{ width: iconSize + 2, alignItems: 'center' }}>
        <Icon name={icon.name} size={iconSize} color={icon.color ?? foreground} />
      </View>
    );
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
    const derivedState: AvatarState =
      avatar.state ?? (loading ? 'loading' : avatar.picture ? 'image' : 'fallback');
    leadingEl = (
      <Avatar
        state={derivedState}
        picture={avatar.picture}
        seed={avatar.seed}
        name={avatar.name}
        size={avatar.size ?? DEFAULT_AVATAR_SIZE}
      />
    );
  }

  // ----- Title / subtitle rendering — strings get default styling, ReactNode is passthrough -----

  const titleIsNode = typeof title !== 'string' && title != null;
  const titleEl = titleIsNode ? (
    title
  ) : (
    <Text
      size={16}
      bold
      numberOfLines={1}
      color={foreground}
      loading={loading}
      placeholder={titlePlaceholder}
      fallback={titleFallback}>
      {title as string | undefined}
    </Text>
  );

  const subtitleIsNode = typeof subtitle !== 'string' && subtitle != null;
  const subtitleEl =
    subtitle == null && subtitleFallback == null && !loading ? null : subtitleIsNode ? (
      subtitle
    ) : (
      <Text
        size={14}
        numberOfLines={wrapSubtitle ? undefined : 1}
        color={opacity(foreground, 0.5)}
        loading={loading}
        placeholder={subtitlePlaceholder}
        fallback={subtitleFallback}>
        {subtitle as string | undefined}
      </Text>
    );

  // ----- Row content -----

  // When `accentPosition='below'`, pull the accent out of the text column so the
  // leading + trailing slots align with just the title/subtitle band. The accent
  // renders as a sibling row beneath, indented past the leading width so it
  // hangs under the title rather than restarting at the row edge.
  const accentBelow = accentPosition === 'below' && accent != null;
  const leadingWidth =
    avatar?.size ?? iconCircle?.size ?? (leading != null ? DEFAULT_AVATAR_SIZE : 0);
  const accentInsetLeft = leadingEl
    ? paddingHorizontal + leadingWidth + ROW_GAP
    : paddingHorizontal;

  const mainRow = (
    <HStack
      align="center"
      style={{
        paddingHorizontal,
        paddingTop: paddingVertical,
        paddingBottom: accentBelow ? 0 : paddingVertical,
        gap: ROW_GAP,
      }}>
      {leadingEl}
      <VStack style={styles.textCol} spacing={2}>
        {titleEl}
        {subtitleEl}
        {accentBelow ? null : accent}
      </VStack>
      {trailing}
    </HStack>
  );

  const body = accentBelow ? (
    <VStack>
      {mainRow}
      <View
        style={{
          paddingLeft: accentInsetLeft,
          paddingRight: paddingHorizontal,
          paddingTop: 4,
          paddingBottom: paddingVertical,
        }}>
        {accent}
      </View>
    </VStack>
  ) : (
    mainRow
  );

  // ----- Pressable wrapper (only if onPress), disabled dim, press-feedback -----

  if (!onPress) {
    return (
      <View testID={testID} style={[disabled && styles.disabled, style]}>
        {body}
      </View>
    );
  }

  const a11yLabel = accessibilityLabel ?? (typeof title === 'string' ? title : undefined);

  // Settings-row press grammar (see SettingsScreen): subtle scale on the
  // content + a ripple expanding from the touch point, instead of a flat
  // full-row highlight. `animation={false}` moves the scale from the root to
  // the compound `.Scale` part, matching the settings rows exactly.
  return (
    <PressableFeedback
      testID={testID}
      animation={false}
      onPress={guardedPress}
      isDisabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={[disabled && styles.disabled, style]}>
      <PressableFeedback.Scale>{body}</PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
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
