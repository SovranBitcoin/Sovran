import { memo } from 'react';
import { withAlpha } from '@/shared/lib/color';

import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { radius } from '@/shared/styles/tokens';
import type { GlassSearchBarProps } from './types';
import { SearchTextInput } from './searchTextInput';

export const GlassSearchBar = memo(function GlassSearchBar({
  width,
  height = 44,
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
      </View>
    </Log>
  );
});
