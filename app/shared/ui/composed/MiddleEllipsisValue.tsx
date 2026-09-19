/**
 * @fileoverview A long identifier shown in full and shortened only on screen.
 *
 * Drop-in `value` for a `DetailsList` / `DetailsSection` row holding an
 * invoice, token, key, address or id. The full string is rendered and the
 * text view elides its middle to fit the row, so the prefix and checksum-like
 * tail both stay visible and nothing downstream ever sees a sliced value.
 * Use `CopyableValue` instead when the row should also copy on tap.
 */

import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface MiddleEllipsisValueProps {
  /** The full value. */
  value: string;
  testID?: string;
}

export function MiddleEllipsisValue({ value, testID }: MiddleEllipsisValueProps) {
  const foreground = useThemeColor('foreground');
  return (
    <Text
      testID={testID}
      bold
      size={16}
      color={foreground}
      numberOfLines={1}
      ellipsizeMode="middle"
      className="shrink text-right">
      {value}
    </Text>
  );
}
