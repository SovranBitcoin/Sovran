import { memo } from 'react';
import { StyleSheet } from 'react-native';

import { GlassView } from 'expo-glass-effect';

import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { withAlpha } from '@/shared/lib/color';
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

  // Liquid devices get a real glass capsule (the component's namesake);
  // everywhere else keeps the flat surface-secondary field.
  const liquid = supportsLiquidGlass();
  const input = (
    <SearchTextInput
      {...field}
      placeholderTextColor={withAlpha(foreground, 0.33)}
      style={[
        styles.input,
        liquid
          ? [styles.inputLiquid, { borderRadius: height / 2 }]
          : { backgroundColor: surfaceSecondary },
        { color: foreground, height },
      ]}
    />
  );

  return (
    <Log name="GlassSearchBar">
      <View style={{ alignItems: 'center', ...(width != null ? { width } : { flex: 1 }) }}>
        {liquid ? (
          <GlassView
            style={[styles.glassShell, { borderRadius: height / 2, height }]}
            glassEffectStyle="regular">
            {input}
          </GlassView>
        ) : (
          input
        )}
      </View>
    </Log>
  );
});

const styles = StyleSheet.create({
  // Capsule (radius = height/2 applied inline) matching the liquid design
  // language; the GlassView owns the material, the input goes transparent.
  glassShell: {
    width: '100%',
  },
  input: {
    width: '100%',
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 0,
  },
  inputLiquid: {
    backgroundColor: 'transparent',
  },
});
