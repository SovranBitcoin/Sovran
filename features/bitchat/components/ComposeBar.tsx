import React, { useState, useCallback } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

interface ComposeBarProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export const ComposeBar = React.memo(function ComposeBar({
  onSend,
  disabled,
}: ComposeBarProps) {
  const [text, setText] = useState('');
  const [foreground, surface, accent] = useThemeColor([
    'foreground',
    'surface',
    'accent',
  ] as const);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <View style={[styles.container, { backgroundColor: surface }]}>
      <TextInput
        style={[
          styles.input,
          {
            color: foreground,
            backgroundColor: opacity(foreground, 0.06),
          },
        ]}
        value={text}
        onChangeText={setText}
        placeholder="Message..."
        placeholderTextColor={opacity(foreground, 0.35)}
        multiline
        maxLength={1000}
        editable={!disabled}
        onSubmitEditing={handleSend}
        blurOnSubmit={false}
      />
      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        style={[
          styles.sendButton,
          {
            backgroundColor: canSend ? accent : opacity(foreground, 0.1),
          },
        ]}>
        <Feather
          name="arrow-up"
          size={20}
          color={canSend ? '#fff' : opacity(foreground, 0.3)}
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
