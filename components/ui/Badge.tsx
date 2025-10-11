import * as React from 'react';
import { ViewStyle } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { HStack } from './View';
import { Text } from './Text';
import { cn } from 'helper/utils';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';

const badgeVariants = cva(
  'rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        primary: '',
        secondary: '',
        warning: '',
        error: '',
        success: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  }
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  icon?: string;
  size?: number;
  color?: string;
  className?: string;
  children?: React.ReactNode;
}

function Badge({ className, variant, icon, size = 12, color, children }: BadgeProps) {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();

  const getVariantStyles = (): ViewStyle => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: opacity(getPrimaryColor('100'), 0.2),
          borderColor: 'transparent',
        };
      case 'secondary':
        return {
          backgroundColor: opacity(getPrimaryColor('200'), 0.2),
          borderColor: 'transparent',
        };
      case 'warning':
        return {
          backgroundColor: opacity(getRedColor('300'), 0.2),
          borderColor: 'transparent',
        };
      case 'error':
        return {
          backgroundColor: opacity(getRedColor('300'), 0.2),
          borderColor: 'transparent',
        };
      case 'success':
        return {
          backgroundColor: opacity(getGreenColor('500'), 0.2),
          borderColor: 'transparent',
        };
      default:
        return {
          backgroundColor: opacity(getPrimaryColor('100'), 0.2),
          borderColor: 'transparent',
        };
    }
  };

  const getTextColor = () => {
    if (color) return color;

    switch (variant) {
      case 'primary':
        return getPrimaryColor('900');
      case 'secondary':
        return getPrimaryColor('800');
      case 'warning':
        return getRedColor('500');
      case 'error':
        return getRedColor('500');
      case 'success':
        return getGreenColor('300');
      default:
        return getPrimaryColor('900');
    }
  };

  const variantStyles = getVariantStyles();
  const textColor = getTextColor();
  const isIconOnly = icon && !children;

  return (
    <HStack
      gap={isIconOnly ? 0 : 4}
      className={cn(badgeVariants({ variant }), className)}
      justify="center"
      align="center"
      style={{
        ...variantStyles,
        paddingHorizontal: isIconOnly ? 0 : 10, // px-2.5 equivalent
        paddingVertical: isIconOnly ? 0 : 2, // py-0.5 equivalent
        width: isIconOnly ? ((size + 4) as number) : undefined, // Make it square for icon-only
        height: isIconOnly ? ((size + 4) as number) : undefined,
      }}>
      {icon && <Icon name={icon} size={size} color={textColor} />}
      {children && (
        <Text size={size} bold overpass color={textColor}>
          {children}
        </Text>
      )}
    </HStack>
  );
}

export { Badge, badgeVariants };
