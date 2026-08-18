import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
// eslint-disable-next-line import/namespace
import * as CheckboxPrimitive from '@rn-primitives/checkbox';

import type { SelectableCheckProps } from './types';

/**
 * Native-feeling square checkbox — bordered square that fills with the
 * variant color when selected. Used by surfaces that want a familiar
 * platform checkbox affordance (onboarding terms, settings toggles, mint
 * lists). For in-app accent selection prefer the circle style.
 */
export function SelectableCheckSquare({
  selected,
  onChange,
  disabled = false,
  size = 20,
  variant = 'default',
  accessibilityLabel,
  accessibilityHint,
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

  return (
    /* eslint-disable-next-line import/namespace */
    <CheckboxPrimitive.Root
      checked={selected}
      onCheckedChange={onChange ?? (() => {})}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
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
      {/* eslint-disable-next-line import/namespace */}
      <CheckboxPrimitive.Indicator>
        <Icon name="fluent:checkmark-16-filled" color={palette.mark} size={iconSize} />
        {/* eslint-disable-next-line import/namespace */}
      </CheckboxPrimitive.Indicator>
      {/* eslint-disable-next-line import/namespace */}
    </CheckboxPrimitive.Root>
  );
}
