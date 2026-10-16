import { View } from 'react-native';

import { useStylePaint } from '@/shared/styles/appStyle';
import { useSurfaceInset } from '@/shared/ui/composed/Surface';
import { Text } from '@/shared/ui/primitives/Text';

interface SectionHeadingProps {
  label: string;
  /** Quieter text on the trailing edge: a count, a status. */
  detail?: string;
  /**
   * `title` (the default) names the group: "Needs your review".
   *
   * `caption` is the quiet line over a list of payments. The rows are what
   * that card is for, so the line is small and regular weight: the day alone
   * in a person's payments.
   *
   * `status` names what state a card of payments is in: "Pending" and
   * "Confirmed" on the home. The name is strong, with its day stacked quietly
   * beneath it, so the two blocks are told apart at a glance.
   */
  tone?: 'title' | 'caption' | 'status';
}

/**
 * The line at the top of a group inside a `Surface`, on the same inset as its
 * rows. The one heading for grouped content: case, family and padding are the
 * active style's.
 */
export function SectionHeading({ label, detail, tone = 'title' }: SectionHeadingProps) {
  const paint = useStylePaint();
  const inset = useSurfaceInset();
  if (tone === 'status') {
    return (
      <View
        className="pb-1"
        style={{ paddingHorizontal: inset, paddingTop: inset > 0 ? paint.style.space.pad : 0 }}>
        <Text heavy size={16} color={paint.text.primary} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text size={12} color={paint.text.secondary} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    );
  }
  const caption = tone === 'caption';
  const upper = !caption && paint.style.type.uppercaseLabels;
  const topSpace = caption ? paint.style.space.item : paint.style.space.pad;
  // A caption is one soft tone throughout; a title is strong with a quieter
  // detail beside it.
  const text = caption
    ? { size: 12, color: paint.text.secondary }
    : { size: 16, color: paint.text.primary, semibold: true, family: paint.style.type.family };
  const trailing = caption
    ? { size: 12, color: paint.text.tertiary }
    : { size: 13, color: paint.text.secondary };
  return (
    <View
      className={
        caption
          ? 'flex-row items-center justify-between'
          : 'flex-row items-baseline justify-between pb-1'
      }
      style={{ paddingHorizontal: inset, paddingTop: inset > 0 ? topSpace : 0 }}>
      <Text {...text} numberOfLines={caption ? 1 : undefined}>
        {upper ? label.toUpperCase() : label}
      </Text>
      {detail ? (
        <Text {...trailing} numberOfLines={caption ? 1 : undefined}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
