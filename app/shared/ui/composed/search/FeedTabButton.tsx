import { useMemo } from 'react';
import { View } from 'react-native';
import { withAlpha } from '@/shared/lib/color';
import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { alpha, fontSize } from '@/shared/styles/tokens';

const POST_FONT_FAMILY = 'mona' as const;
const postInk = { primary: 0.9, secondary: alpha.disabled } as const;

/**
 * Rounded pill tab used in the Feed/Notifications header filter rows and the
 * People/Posts search toggle (Feed + Contacts). Shared so the search scope
 * selector looks and behaves identically across surfaces.
 */
export function FeedTabButton({
  label,
  active,
  showChevron = false,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  showChevron?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const activeBg = useMemo(() => withAlpha(surfaceTertiary, 0.5), [surfaceTertiary]);
  const pressedBg = useMemo(() => withAlpha(surfaceTertiary, 0.65), [surfaceTertiary]);
  const labelColor = active ? foreground : withAlpha(foreground, postInk.secondary);
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      haptics={!!onPress}
      activeOpacity={1}
      className="rounded-full"
      style={({ pressed }) => ({
        backgroundColor: pressed ? pressedBg : active ? activeBg : 'transparent',
      })}>
      <View className="min-h-[34px] flex-row items-center justify-center gap-1.5 rounded-full px-4 py-1">
        {/* Selection reads in the type too (weight + ink), not only the pill. */}
        <Text family={POST_FONT_FAMILY} semibold={active} size={fontSize.xl} color={labelColor}>
          {label}
        </Text>
        {showChevron ? <Icon name="mdi:chevron-down" size={16} color={labelColor} /> : null}
      </View>
    </Pressable>
  );
}
