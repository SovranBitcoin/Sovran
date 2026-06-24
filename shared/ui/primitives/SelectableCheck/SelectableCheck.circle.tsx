import React from 'react';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';

import opacity from 'hex-color-opacity';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';

import type { SelectableCheckProps } from './types';

/**
 * In-app accent selection mark — a filled circle with a white check when
 * selected. The split-bill participant picker is the canonical surface; the
 * goal is a brand-feeling tap target rather than a native checkbox.
 *
 * Pure visual when `onChange` is omitted (the parent row owns the press,
 * which is the ContactRow pattern). When `onChange` is provided the mark
 * wraps itself in a `Pressable` so it can stand alone.
 */
export function SelectableCheckCircle({
  selected,
  onChange,
  disabled = false,
  size = 20,
  accessibilityLabel,
  accessibilityHint,
}: SelectableCheckProps) {
  const [foreground, accent] = useThemeColor(['foreground', 'accent'] as const);

  const visual = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: selected ? accent : opacity(foreground, 0.25),
        backgroundColor: selected ? accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}>
      {selected ? <Icon name="mdi:check" size={Math.round(size * 0.65)} color={INVARIANT_WHITE} /> : null}
    </View>
  );

  if (!onChange) return visual;

  return (
    <Pressable
      onPress={() => !disabled && onChange(!selected)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
      hitSlop={8}>
      {visual}
    </Pressable>
  );
}
