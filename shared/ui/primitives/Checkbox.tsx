import React from 'react';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
// eslint-disable-next-line import/namespace
import * as CheckboxPrimitive from '@rn-primitives/checkbox';

interface CheckboxProps {
  checked?: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: number;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
}

export const Checkbox = ({
  checked = false,
  onCheckedChange,
  disabled = false,
  size = 20,
  variant = 'default',
}: CheckboxProps) => {
  const [foreground, muted, surface, danger, blue300, green400, warning] = useThemeColor([
    'foreground',
    'muted',
    'surface',
    'danger',
    'blue-300',
    'green-400',
    'warning',
  ] as const);

  const getVariantColors = () => {
    const variants = {
      default: {
        border: muted,
        background: checked ? foreground : 'transparent',
        checkmark: surface,
      },
      primary: {
        border: checked ? blue300 : muted,
        background: checked ? blue300 : 'transparent',
        checkmark: 'white',
      },
      success: {
        border: checked ? green400 : muted,
        background: checked ? green400 : 'transparent',
        checkmark: 'white',
      },
      warning: {
        border: checked ? warning : muted,
        background: checked ? warning : 'transparent',
        checkmark: 'white',
      },
      error: {
        border: checked ? danger : muted,
        background: checked ? danger : 'transparent',
        checkmark: 'white',
      },
    };

    return variants[variant];
  };

  const colors = getVariantColors();
  const iconSize = size * 0.6; // 60% of checkbox size

  return (
    /* eslint-disable-next-line import/namespace */
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      style={{
        height: size,
        width: size,
        borderWidth: 1.5,
        borderColor: colors.border,
        backgroundColor: colors.background,
        borderRadius: size * 0.2, // 20% border radius for slightly rounded corners
        justifyContent: 'center',
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      }}>
      {/* eslint-disable-next-line import/namespace */}
      <CheckboxPrimitive.Indicator>
        <Icon name="fluent:checkmark-16-filled" color={colors.checkmark} size={iconSize} />
        {/* eslint-disable-next-line import/namespace */}
      </CheckboxPrimitive.Indicator>
      {/* eslint-disable-next-line import/namespace */}
    </CheckboxPrimitive.Root>
  );
};
