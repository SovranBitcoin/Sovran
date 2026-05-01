import React from 'react';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import opacity from 'hex-color-opacity';

/**
 * Placeholder body for the AI tab when the active session has no messages.
 * A faint centered glyph — matches the Grok-style empty state.
 */
export function AiEmptyState() {
  const foreground = useThemeColor('foreground');
  return (
    <View style={{ flex: 1 }}>
      <VStack align="center" justify="center" style={{ flex: 1 }}>
        <Icon name="mdi:robot" size={120} color={opacity(foreground, 0.08)} />
      </VStack>
    </View>
  );
}
