import { memo } from 'react';
import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';

import { Log } from '@/shared/lib/logger';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { radius } from '@/shared/styles/tokens';
import type { GlassSearchBarProps } from './types';
import { SearchTextInput } from './searchTextInput';

export const GlassSearchBar = memo(function GlassSearchBar({
  width,
  height = 44,
  value,
  onClear,
  ...field
}: GlassSearchBarProps) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  return (
    <Log name="GlassSearchBar">
      <View
        style={{
          // A definite width is REQUIRED inside Android native-header title
          // slots: RNS's center subview is auto-width, so a flex:1 child
          // contributes 0 to the parent's content size and the bar collapses
          // to nothing (mirrors GlassSearchBar.ios). flex:1 only as the
          // fallback outside headers.
          ...(width != null ? { width } : { flex: 1, marginRight: 8 }),
          height,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: surfaceSecondary,
          borderRadius: radius.lg,
          paddingHorizontal: 12,
        }}>
        <SearchTextInput
          {...field}
          placeholderTextColor={withAlpha(foreground, 0.33)}
          style={{
            flex: 1,
            color: foreground,
            fontSize: 16,
            fontFamily: 'OxygenRegular',
          }}
        />
        {onClear && value ? (
          <Pressable
            testID={field.testID ? `${field.testID}-clear` : undefined}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            onPress={onClear}
            className="-mr-1 h-7 w-7 shrink-0 items-center justify-center rounded-full">
            <Icon name="mdi:close-circle" size={18} color={withAlpha(foreground, 0.5)} />
          </Pressable>
        ) : null}
      </View>
    </Log>
  );
});
