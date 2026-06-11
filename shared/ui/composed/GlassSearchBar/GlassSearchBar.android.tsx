import React, { memo, useCallback, useEffect, useRef } from 'react';
import { TextInput } from 'react-native';
import opacity from 'hex-color-opacity';

import { Log } from '@/shared/lib/logger';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { radius } from '@/shared/styles/tokens';
import type { GlassSearchBarProps } from './types';

export const GlassSearchBar = memo(function GlassSearchBar({
  clearKey,
  onChangeText,
  placeholder,
  keyboardType = 'web-search',
  autoFocus,
  debounceMs,
  seedText = '',
  width,
  height = 44,
}: GlassSearchBarProps) {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);
  const inputRef = useRef<TextInput>(null);
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
        <TextInput
          key={clearKey}
          ref={inputRef}
          defaultValue={seedText}
          onChangeText={handleTextChange}
          placeholder={placeholder}
          placeholderTextColor={opacity(foreground, 0.33)}
          accessibilityLabel={placeholder}
          accessibilityRole="search"
          style={{
            flex: 1,
            color: foreground,
            fontSize: 16,
            fontFamily: 'OxygenRegular',
          }}
          keyboardType={keyboardType}
          autoCorrect={false}
          autoFocus={autoFocus}
        />
      </View>
    </Log>
  );
});
