import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { HStack } from './View';
import { Text } from './Text';
import { cn } from 'lib/utils';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';

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

export interface BadgeProps
  extends React.ComponentPropsWithoutRef<'div'>,
    VariantProps<typeof badgeVariants> {
  icon?: string;
  size?: number;
  color?: string;
}

function Badge({ className, variant, icon, size = 12, color, children, ...props }: BadgeProps) {
  const theme = useSelector(memoizedGetTheme);
  const g = greys(theme);

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: g[100],
          borderColor: 'transparent',
        };
      case 'secondary':
        return {
          backgroundColor: g[200],
          borderColor: 'transparent',
        };
      case 'warning':
        return {
          backgroundColor: '#f59e0b',
          borderColor: 'transparent',
        };
      case 'error':
        return {
          backgroundColor: '#ef4444',
          borderColor: 'transparent',
        };
      case 'success':
        return {
          backgroundColor: '#10b981',
          borderColor: 'transparent',
        };
      default:
        return {
          backgroundColor: g[100],
          borderColor: 'transparent',
        };
    }
  };

  const getTextColor = () => {
    if (color) return color;

    switch (variant) {
      case 'primary':
        return g[900];
      case 'secondary':
        return g[800];
      case 'warning':
        return '#92400e';
      case 'error':
        return '#7f1d1d';
      case 'success':
        return '#064e3b';
      default:
        return g[900];
    }
  };

  const variantStyles = getVariantStyles();
  const textColor = getTextColor();
  const isIconOnly = icon && !children;

  return (
    <HStack
      align="center"
      gap={isIconOnly ? 0 : 4}
      className={cn(badgeVariants({ variant }), className)}
      style={{
        ...variantStyles,
        paddingHorizontal: isIconOnly ? 0 : 10, // px-2.5 equivalent
        paddingVertical: isIconOnly ? 0 : 2, // py-0.5 equivalent
        width: isIconOnly ? size + 4 : undefined, // Make it square for icon-only
        height: isIconOnly ? size + 4 : undefined,
        justifyContent: 'center',
        alignItems: 'center',
      }}
      {...props}>
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
