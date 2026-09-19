/**
 * The app's one notice box: status icon, optional title, optional
 * description. Replaces the old info/warning `Card`.
 *
 * - `info` is quiet (secondary surface, muted icon) — supporting copy such as
 *   a memo, a mint's description or a bio. It may carry a custom `icon`.
 * - `warning` (solid amber, dark ink) and `danger` (solid red, white ink) are
 *   for consequences the user must not miss: money that won't be credited, an
 *   action that can't be undone.
 *
 * A plain View with the app's own `Text`. The first version sat on HeroUI's
 * Alert, whose title and description render through HeroUI's text component;
 * on device that notice clipped its last line and left extra bottom padding.
 * Outer spacing belongs to the caller — pass it through `className`.
 */

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { INVARIANT_BLACK, INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { withAlpha } from '@/shared/lib/color';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';

type NoticeStatus = 'info' | 'warning' | 'danger';

/** Distinct shapes, not just colours: triangle = caution, circle-bang =
 *  error, circle-i = information. */
const STATUS_ICON: Record<NoticeStatus, string> = {
  info: 'ri:information-fill',
  warning: 'ri:alert-fill',
  danger: 'ri:error-warning-fill',
};

const STATUS_ROOT: Record<NoticeStatus, string> = {
  info: 'bg-surface-secondary',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

interface NoticeProps {
  status: NoticeStatus;
  title?: string;
  description?: string;
  /** Icon registry name replacing the status icon (info notices only need
   *  this — warnings and errors keep their shape so they read at a glance). */
  icon?: string;
  className?: string;
  testID?: string;
}

export function Notice({ status, title, description, icon, className, testID }: NoticeProps) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const ink =
    status === 'warning' ? INVARIANT_BLACK : status === 'danger' ? INVARIANT_WHITE : foreground;
  const bodyInk = status === 'info' ? muted : withAlpha(ink, 0.82);
  const iconColor = status === 'info' ? muted : ink;
  const label = [title, description].filter(Boolean).join('. ');

  return (
    <View
      accessible
      accessibilityRole={status === 'info' ? 'text' : 'alert'}
      accessibilityLabel={label}
      testID={testID}
      className={`${STATUS_ROOT[status]} flex-row items-start gap-3 rounded-2xl px-4 py-3 ${className ?? ''}`}>
      <Icon name={icon ?? STATUS_ICON[status]} size={20} color={iconColor} />
      <View className="min-w-0 flex-1 gap-0.5">
        {title ? (
          <Text size={15} bold color={ink}>
            {title}
          </Text>
        ) : null}
        {description ? (
          <Text size={14} color={title ? bodyInk : ink}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
