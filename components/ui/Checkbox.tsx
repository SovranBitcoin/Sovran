import React from 'react';
import { useTheme } from 'providers/ThemeProvider';
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
  const { getPrimaryColor } = useTheme();

  // Variant color configuration
  const getVariantColors = () => {
    const variants = {
      default: {
        border: getPrimaryColor('400'),
        background: checked ? getPrimaryColor('0') : 'transparent',
        checkmark: getPrimaryColor('900'),
      },
      primary: {
        border: checked ? '#3b82f6' : getPrimaryColor('400'),
        background: checked ? '#3b82f6' : 'transparent',
        checkmark: 'white',
      },
      success: {
        border: checked ? '#10b981' : getPrimaryColor('400'),
        background: checked ? '#10b981' : 'transparent',
        checkmark: 'white',
      },
      warning: {
        border: checked ? '#f59e0b' : getPrimaryColor('400'),
        background: checked ? '#f59e0b' : 'transparent',
        checkmark: 'white',
      },
      error: {
        border: checked ? '#ef4444' : getPrimaryColor('400'),
        background: checked ? '#ef4444' : 'transparent',
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
