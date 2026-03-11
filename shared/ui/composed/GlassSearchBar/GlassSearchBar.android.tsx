import React, { memo, useCallback, useEffect, useRef } from 'react';
import { TextInput, InteractionManager } from 'react-native';
import opacity from 'hex-color-opacity';

import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { GlassSearchBarProps } from './types';

export const GlassSearchBar = memo(function GlassSearchBar({
  clearKey,
  onChangeText,
  placeholder,
  keyboardType = 'web-search',
  autoFocus,
  debounceMs,
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
        InteractionManager.runAfterInteractions(() => {
          onChangeTextRef.current(latestTextRef.current);
        });
      }, debounceMs);
    },
    [debounceMs]
  );

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: surfaceSecondary,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
      }}>
      <TextInput
        key={clearKey}
        ref={inputRef}
        defaultValue=""
        onChangeText={handleTextChange}
        placeholder={placeholder}
        placeholderTextColor={opacity(foreground, 0.33)}
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
  );
});
