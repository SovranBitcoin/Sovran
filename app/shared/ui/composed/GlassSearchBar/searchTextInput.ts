import { createElement, useCallback, useEffect, useRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import type { GlassSearchBarProps } from './types';

/**
 * Keeps the latest `onChangeText` in a ref so the handler identity only
 * changes with `debounceMs`, trailing-debounces when it is set, and drops a
 * pending emit on clear (`clearKey`) and unmount.
 */
function useDebouncedSearchText({
  onChangeText,
  debounceMs,
  clearKey,
}: Pick<GlassSearchBarProps, 'onChangeText' | 'debounceMs' | 'clearKey'>) {
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

  return useCallback(
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
}

type SearchTextInputProps = Omit<GlassSearchBarProps, 'width' | 'height'> &
  Pick<TextInputProps, 'placeholderTextColor' | 'style'>;

/**
 * The text input both platform bars wrap: debounced changes, a remount with
 * `seedText` whenever `clearKey` changes, and the search keyboard and
 * accessibility. The platforms supply only its colours and layout.
 */
export function SearchTextInput({
  clearKey,
  onChangeText,
  debounceMs,
  seedText = '',
  placeholder,
  keyboardType = 'web-search',
  ...rest
}: SearchTextInputProps) {
  const handleTextChange = useDebouncedSearchText({ onChangeText, debounceMs, clearKey });
  // `rest` is the test id, autofocus and the platform's colours and layout.
  return createElement(TextInput, {
    ...rest,
    key: clearKey,
    defaultValue: seedText,
    onChangeText: handleTextChange,
    placeholder,
    accessibilityLabel: placeholder,
    accessibilityRole: 'search',
    keyboardType,
    autoCorrect: false,
    autoCapitalize: 'none',
  });
}
