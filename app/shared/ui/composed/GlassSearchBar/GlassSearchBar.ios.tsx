import { memo, useCallback, useEffect, useRef } from 'react';
import { TextInput, StyleSheet } from 'react-native';

import { GlassView } from 'expo-glass-effect';

import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import opacity from 'hex-color-opacity';
import type { GlassSearchBarProps } from './types';

export const GlassSearchBar = memo(function GlassSearchBar({
  testID,
  width,
  height = 44,
  clearKey,
  onChangeText,
  placeholder,
  keyboardType = 'web-search',
  autoFocus,
  debounceMs,
  seedText = '',
}: GlassSearchBarProps) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeTextRef = useRef(onChangeText);
  const latestTextRef = useRef('');

  useEffect(() => {
    onChangeTextRef.current = onChangeText;
  }, [onChangeText]);

  // Cancel pending debounce when clearKey changes (user pressed X)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    latestTextRef.current = '';
  }, [clearKey]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleTextChange = useCallback(
    (text: string) => {
      if (!debounceMs) {
        onChangeTextRef.current(text);
        return;
      }
      latestTextRef.current = text;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChangeTextRef.current(latestTextRef.current);
      }, debounceMs);
    },
    [debounceMs]
  );

  // Liquid devices get a real glass capsule (the component's namesake);
  // everywhere else keeps the flat surface-secondary field.
  const liquid = supportsLiquidGlass();
  const input = (
    <TextInput
      testID={testID}
      key={clearKey}
      defaultValue={seedText}
      placeholder={placeholder}
      placeholderTextColor={opacity(foreground, 0.33)}
      onChangeText={handleTextChange}
      keyboardType={keyboardType}
      autoCorrect={false}
      autoCapitalize="none"
      autoFocus={autoFocus}
      accessibilityLabel={placeholder}
      accessibilityRole="search"
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
    overflow: 'hidden',
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
