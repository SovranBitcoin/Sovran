/**
 * The app's one notice box: status icon, optional title, optional
 * description. Replaces the old info/warning `Card`.
 *
 * - `info` is quiet (secondary surface, muted icon) — supporting copy such as
 *   a memo, a mint's description or a bio. It may carry a custom `icon`.
 * - `warning` and `danger` are for consequences the user must not miss: money
 *   that won't be credited, an action that can't be undone.
 *
 * `tone` sets how loudly a warning or danger reads. `solid` (amber/red fill,
 * invariant ink) interrupts; `soft` (tinted surface, themed ink) sits inside a
 * sheet or card next to other content without shouting over it. `info` looks
 * the same either way — it is already the quiet end of the scale.
 *
 * `size="compact"` is the full-bleed strip used above a chat composer or
 * inside a dense sheet: smaller icon and type. The caller still owns the
 * outer spacing and the corners, via `className`.
 *
 * A plain View with the app's own `Text`. The first version sat on HeroUI's
 * Alert, whose title and description render through HeroUI's text component;
 * on device that notice clipped its last line and left extra bottom padding.
 * Outer spacing belongs to the caller — pass it through `className`.
 */

import type { ReactNode } from 'react';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { cn } from '@/shared/lib/classNames';
import { withAlpha } from '@/shared/lib/color';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';

type NoticeStatus = 'info' | 'warning' | 'danger';
type NoticeTone = 'solid' | 'soft';
type NoticeSize = 'default' | 'compact';

/** Distinct shapes, not just colours: triangle = caution, circle-bang =
 *  error, circle-i = information. */
const STATUS_ICON: Record<NoticeStatus, string> = {
  info: 'ri:information-fill',
  warning: 'ri:alert-fill',
  danger: 'ri:error-warning-fill',
};

const SOLID_ROOT: Record<NoticeStatus, string> = {
  info: 'bg-surface-secondary',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const SOFT_ROOT: Record<NoticeStatus, string> = {
  info: 'bg-surface-secondary',
  warning: 'bg-warning-soft',
  danger: 'bg-danger-soft',
};

/** Icon and type scale per size. `compact` matches the chat status strips. */
const SIZE = {
  default: { icon: 20, title: 15, body: 14, gap: 'gap-3' },
  compact: { icon: 16, title: 13, body: 12, gap: 'gap-2' },
} as const;

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
   *  this — warnings and errors keep their shape so they read at a glance). */
  icon?: string;
  /** Trailing recovery affordance, e.g. a compact "Open Settings" button. */
  action?: ReactNode;
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
  className,
  testID,
}: NoticeProps) {
  const [foreground, muted, warning, danger, warningSoftFg, dangerSoftFg] = useThemeColor([
    'foreground',
    'muted',
    'warning',
    'danger',
    'warning-soft-foreground',
    'danger-soft-foreground',
  ] as const);
  const soft = tone === 'soft';
  const statusInk = (
    {
      info: { solid: foreground, soft: foreground, softGlyph: muted },
      warning: { solid: INVARIANT_BLACK, soft: warningSoftFg, softGlyph: warning },
      danger: { solid: INVARIANT_WHITE, soft: dangerSoftFg, softGlyph: danger },
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
  // collapsing it would announce the title alone, or nothing at all.
  const collapsible = label.length > 0 && action === undefined;

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
          <Text size={scale.body} color={title ? bodyInk : ink}>
            {description}
          </Text>
        ) : (
          description
        )}
      </View>
      {action}
    </View>
  );
}
