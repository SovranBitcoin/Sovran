import React, { memo, useCallback, useEffect, useRef } from 'react';
import { TextInput, StyleSheet } from 'react-native';

import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import type { GlassSearchBarProps } from './types';

export const GlassSearchBar = memo(function GlassSearchBar({
  width,
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

  return (
    <Log name="GlassSearchBar">
      <View style={{ alignItems: 'center', ...(width != null ? { width } : { flex: 1 }) }}>
        <TextInput
          key={clearKey}
          defaultValue={seedText}
          placeholder={placeholder}
          placeholderTextColor={opacity(foreground, 0.33)}
          onChangeText={handleTextChange}
          keyboardType={keyboardType}
          autoCorrect={false}
          autoFocus={autoFocus}
          accessibilityLabel={placeholder}
          accessibilityRole="search"
          style={[styles.input, { backgroundColor: surfaceSecondary, color: foreground }]}
        />
      </View>
    </Log>
  );
});

const styles = StyleSheet.create({
  input: {
    height: 44,
    width: '100%',
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    borderWidth: 0,
  },
});
