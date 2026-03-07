import React, { memo, useCallback, useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { Input, TextField } from 'heroui-native';

import { View } from '@/shared/ui/primitives/View/View';
import type { GlassSearchBarProps } from './types';

export const GlassSearchBar = memo(function GlassSearchBar({
  width,
  clearKey,
  onChangeText,
  placeholder,
  keyboardType = 'web-search',
  debounceMs,
}: GlassSearchBarProps) {
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
    <View style={{ alignItems: 'center', width }}>
      <TextField key={clearKey} className="w-full">
        <Input
          defaultValue=""
          placeholder={placeholder}
          onChangeText={handleTextChange}
          keyboardType={keyboardType}
          autoCorrect={false}
          className="bg-surface-secondary text-foreground h-11 w-full rounded-xl border-0 px-3"
        />
      </TextField>
    </View>
  );
});
