/**
 * The app's one notice box: status icon, optional title, optional
 * description. Replaces the old info/warning `Card`.
 *
 * - `info` is quiet (secondary surface, muted icon) — supporting copy such as
 *   a memo, a mint's description or a bio. It may carry a custom `icon`.
 * - `warning` and `danger` are for consequences the user must not miss: money
 *   that won't be credited, an action that can't be undone.
 * - `success` is the rarer twin of those two, and exists for the same reason:
 *   where a warning and its absence would be read as "bad" and "nothing said",
 *   a positive statement is sometimes the whole answer — a provider that
 *   cannot read your messages is not merely one with no warning against it.
 *   Reach for it only where the good outcome is a claim worth making, never
 *   as decoration on a completed step.
 *
 * `tone` sets how loudly a warning, danger or success reads. `solid` (amber/red fill,
 * invariant ink) interrupts; `soft` (tinted surface, themed ink) sits inside a
 * sheet or card next to other content without shouting over it. `info` looks
 * the same either way — it is already the quiet end of the scale.
 *
 * `size="compact"` is the full-bleed strip used above a chat composer or
 * inside a dense sheet: smaller icon and type. The caller still owns the
 * outer spacing and the corners, via `className`.
 *
 * Long supporting copy — a bio, a mint's description — is where an info page
 * used to jump: the card landed late at whatever height the text needed.
 * Three props make the card's height a decision the caller takes up front:
 * `reserveLines` holds room for that many body lines whether or not copy has
 * arrived, `loading` draws the whole card as one skeleton block at that height, and
 * `collapseLines` clamps longer copy to that many lines with a "Show more"
 * toggle (the feed's pattern), so a two-line card stays a two-line card.
 *
 * A plain View with the app's own `Text`. The first version sat on HeroUI's
 * Alert, whose title and description render through HeroUI's text component;
 * on device that notice clipped its last line and left extra bottom padding.
 * Outer spacing belongs to the caller — pass it through `className`.
 */

import { useCallback, useState, type ReactNode } from 'react';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { cn } from '@/shared/lib/classNames';
import { withAlpha } from '@/shared/lib/color';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';

type NoticeStatus = 'info' | 'warning' | 'danger' | 'success';
type NoticeTone = 'solid' | 'soft';
type NoticeSize = 'default' | 'compact';

/** Distinct shapes, not just colours: triangle = caution, circle-bang =
 *  error, circle-i = information, circle-tick = confirmed. Green and amber are
 *  the pair most often indistinguishable to a reader who cannot separate them,
 *  so the difference cannot live in the fill alone. */
const STATUS_ICON: Record<NoticeStatus, string> = {
  info: 'ri:information-fill',
  warning: 'ri:alert-fill',
  danger: 'ri:error-warning-fill',
  success: 'mdi:check-circle',
};

const SOLID_ROOT: Record<NoticeStatus, string> = {
  info: 'bg-surface-secondary',
  warning: 'bg-warning',
  danger: 'bg-danger',
  success: 'bg-success',
};

const SOFT_ROOT: Record<NoticeStatus, string> = {
  info: 'bg-surface-secondary',
  warning: 'bg-warning-soft',
  danger: 'bg-danger-soft',
  success: 'bg-success-soft',
};

/** Icon and type scale per size. `compact` matches the chat status strips.
 *  `bodyLineHeight` is explicit so a reserved line count is an exact height. */
const SIZE = {
  default: { icon: 20, title: 15, body: 14, bodyLineHeight: 19, gap: 'gap-3' },
  compact: { icon: 16, title: 13, body: 12, bodyLineHeight: 16, gap: 'gap-2' },
} as const;

/** The low-contrast fill every whole-block skeleton in the app uses. */
const SKELETON_FILL_ALPHA = 0.07;

interface NoticeProps {
  status: NoticeStatus;
  /** How loudly a warning/danger reads. Ignored by `info`. Default `solid`. */
  tone?: NoticeTone;
  size?: NoticeSize;
  title?: string;
  /** A string, or rich content (e.g. `SegmentedText`) when part of the
   *  sentence needs its own emphasis. Rich content owns its own colour. */
  description?: ReactNode;
  /** Icon registry name replacing the status icon (info notices only need
   *  this — warnings, errors and confirmations keep their shape so they read
   *  at a glance). */
  icon?: string;
  /** Trailing recovery affordance, e.g. a compact "Open Settings" button. */
  action?: ReactNode;
  /**
   * Hold room for this many body lines even when `description` is shorter or
   * absent, so the card's height does not depend on what arrives. With
   * `loading`, the same lines show placeholder bars.
   */
  reserveLines?: number;
  /** Copy is still on its way: placeholder bars in the reserved lines. */
  loading?: boolean;
  /**
   * Clamp a string `description` to this many lines and offer "Show more" when
   * it is longer. The toggle only appears once the text has measured longer
   * than the clamp, so short copy shows no control.
   */
  collapseLines?: number;
  className?: string;
  testID?: string;
}

export function Notice({
  status,
  tone = 'solid',
  size = 'default',
  title,
  description,
  icon,
  action,
  reserveLines,
  loading = false,
  collapseLines,
  className,
  testID,
}: NoticeProps) {
  const [
    foreground,
    muted,
    accent,
    warning,
    danger,
    success,
    warningSoftFg,
    dangerSoftFg,
    successSoftFg,
  ] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'warning',
    'danger',
    'success',
    'warning-soft-foreground',
    'danger-soft-foreground',
    'success-soft-foreground',
  ] as const);
  const [expanded, setExpanded] = useState(false);
  // Measured off an unclamped, invisible twin of the copy: iOS reports only
  // the visible lines of a clamped Text, so the clamped one cannot say
  // whether there was more.
  const [fullLineCount, setFullLineCount] = useState<number | null>(null);
  const measureFull = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    setFullLineCount(event.nativeEvent.lines.length);
  }, []);
  const collapsing =
    typeof description === 'string' &&
    collapseLines !== undefined &&
    fullLineCount !== null &&
    fullLineCount > collapseLines;
  const soft = tone === 'soft';
  const statusInk = (
    {
      info: { solid: foreground, soft: foreground, softGlyph: muted },
      warning: { solid: INVARIANT_BLACK, soft: warningSoftFg, softGlyph: warning },
      danger: { solid: INVARIANT_WHITE, soft: dangerSoftFg, softGlyph: danger },
      // Black, like amber and unlike red: Apple System Green is a light fill,
      // and white on it lands around 1.9:1.
      success: { solid: INVARIANT_BLACK, soft: successSoftFg, softGlyph: success },
    } satisfies Record<NoticeStatus, { solid: string; soft: string; softGlyph: string }>
  )[status];
  const ink = soft ? statusInk.soft : statusInk.solid;
  // Solid fills carry their own contrast, so the body is only dimmed against
  // the fill. A soft notice already reads as secondary — dimming it twice
  // pushes the body under the contrast floor.
  const bodyInk = status === 'info' ? muted : soft ? ink : withAlpha(ink, 0.82);
  // On a soft fill the glyph keeps the full amber/red so the notice still
  // reads as caution at a glance; only the copy steps down to the soft ink.
  // On a solid fill the glyph shares the copy's invariant ink.
  const iconColor = status === 'info' ? muted : soft ? statusInk.softGlyph : ink;
  const scale = SIZE[size];
  const root = soft ? SOFT_ROOT[status] : SOLID_ROOT[status];
  // The title and the description are two complete phrases the caller wrote
  // separately, not fragments of one sentence. A screen reader needs a
  // sentence break between them, and a title that already ends in one must not
  // get a second — `RESTART_WARNING_TITLE` ends in a full stop today.
  const named = title !== undefined && title.length > 0 ? title : undefined;
  const spoken =
    typeof description === 'string' && description.length > 0 ? description : undefined;
  const label =
    named !== undefined && spoken !== undefined
      ? `${named}${/[.!?]$/.test(named) ? '' : '.'} ${spoken}`
      : (named ?? spoken ?? '');
  // Collapsing to one accessible node needs a label to read. A rich
  // `description` (SegmentedText, a custom row) contributes nothing to `label`,
  // so the notice stays uncollapsed and the screen reader walks the children —
  // collapsing it would announce the title alone, or nothing at all. A "Show
  // more" toggle is a child the reader must be able to reach, so it too keeps
  // the notice uncollapsed.
  const collapsible = label.length > 0 && action === undefined && !collapsing && !loading;
  const bodyStyle = { lineHeight: scale.bodyLineHeight };
  const reservedHeight =
    reserveLines !== undefined ? { minHeight: scale.bodyLineHeight * reserveLines } : undefined;

  if (loading) {
    // The whole card is the skeleton — one low-contrast block at the height
    // the finished card will have (padding + title line + reserved body
    // lines), not an icon beside a stack of text bars. The finished card's
    // own chrome is drawn invisibly inside so the two heights cannot drift.
    return (
      <View
        accessible={false}
        testID={testID ? `${testID}-loading` : undefined}
        className={cn('flex-row rounded-2xl px-4 py-3', scale.gap, 'items-start', className)}
        style={{ backgroundColor: withAlpha(foreground, SKELETON_FILL_ALPHA) }}>
        <View style={{ width: scale.icon, height: scale.icon }} />
        <View className="min-w-0 flex-1 gap-0.5" style={{ opacity: 0 }}>
          {title ? (
            <Text size={scale.title} bold>
              {title}
            </Text>
          ) : null}
          <View style={{ minHeight: scale.bodyLineHeight * Math.max(1, reserveLines ?? 2) }} />
        </View>
      </View>
    );
  }

  return (
    <View
      accessible={collapsible}
      accessibilityRole={status === 'info' ? 'text' : 'alert'}
      accessibilityLabel={collapsible ? label : undefined}
      testID={testID}
      className={cn(
        root,
        'flex-row rounded-2xl px-4 py-3',
        scale.gap,
        // Multi-line copy hangs from the top so the icon never floats
        // mid-paragraph. A caller whose copy is reliably one line overrides
        // this with `items-center`.
        'items-start',
        className
      )}>
      <Icon name={icon ?? STATUS_ICON[status]} size={scale.icon} color={iconColor} />
      <View className="min-w-0 flex-1 gap-0.5">
        {title ? (
          <Text size={scale.title} bold color={ink}>
            {title}
          </Text>
        ) : null}
        {typeof description === 'string' ? (
          <View style={reservedHeight}>
            {collapseLines !== undefined ? (
              // The measuring twin: same type, same width, never seen.
              <Text
                size={scale.body}
                style={[bodyStyle, { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }]}
                pointerEvents="none"
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onTextLayout={measureFull}>
                {description}
              </Text>
            ) : null}
            <Text
              size={scale.body}
              color={title ? bodyInk : ink}
              style={bodyStyle}
              numberOfLines={collapsing && !expanded ? collapseLines : undefined}>
              {description}
            </Text>
            {collapsing ? (
              <Text
                size={scale.body}
                bold
                color={status === 'info' ? accent : ink}
                style={bodyStyle}
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Show less' : 'Show more'}
                accessibilityState={{ expanded }}
                testID={testID ? `${testID}-toggle` : undefined}
                onPress={() => setExpanded((value) => !value)}>
                {expanded ? 'Show less' : 'Show more'}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={reservedHeight}>{description}</View>
        )}
      </View>
      {action}
    </View>
  );
}
