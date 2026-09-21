import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';

import type { SelectableCheckProps } from './types';

/**
 * Native-feeling square checkbox — bordered square that fills with the
 * variant color when selected. Used by surfaces that want a familiar
 * platform checkbox affordance (onboarding terms, settings toggles, mint
 * lists). For in-app accent selection prefer the circle style.
 *
 * Built on the app's own `Pressable` seam rather than a checkbox library:
 * a checkbox is a tap target that reports `accessibilityRole="checkbox"`
 * and draws a mark when checked, which is all the seam already gives us.
 *
 * Pure visual when `onChange` is omitted (the parent row owns the press).
 * When `onChange` is provided the mark wraps itself in a `Pressable` so it
 * can stand alone.
 */
export function SelectableCheckSquare({
  selected,
  onChange,
  disabled = false,
  size = 20,
  variant = 'default',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: SelectableCheckProps) {
  const [foreground, muted, surface, danger, blue300, green400, warning] = useThemeColor([
    'foreground',
    'muted',
    'surface',
    'danger',
    'blue-300',
    'green-400',
    'warning',
  ] as const);

  const palette = {
    default: { border: muted, fill: foreground, mark: surface },
    primary: { border: blue300, fill: blue300, mark: 'white' },
    success: { border: green400, fill: green400, mark: 'white' },
    warning: { border: warning, fill: warning, mark: 'white' },
    error: { border: danger, fill: danger, mark: 'white' },
  }[variant];

  const iconSize = Math.round(size * 0.6);

  const visual = (
    <View
      style={{
        height: size,
        width: size,
        borderWidth: 1.5,
        borderColor: selected ? palette.border : muted,
        backgroundColor: selected ? palette.fill : 'transparent',
        borderRadius: size * 0.2,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      }}>
      {selected ? (
        <Icon name="fluent:checkmark-16-filled" color={palette.mark} size={iconSize} />
      ) : null}
    </View>
  );

  // Visual-only: the parent row is the control and carries the checked state.
  if (!onChange) return visual;

  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!selected)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
      hitSlop={12}>
      {visual}
    </Pressable>
  );
}
