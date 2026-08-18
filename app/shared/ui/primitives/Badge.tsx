/**
 * @fileoverview Badge Component - Status indicators and labels with theme integration
 *
 * @module shared/ui/primitives/Badge
 *
 * @description
 * **Versatile badge component for status indicators, labels, and visual cues**
 * - Multiple semantic variants (primary, secondary, warning, error, success)
 * - Support for icons, text, or both
 * - Theme-aware colors and styling
 * - Icon-only and text+icon modes
 * - Responsive sizing and positioning
 *
 * **Features:**
 * - Semantic color variants with theme integration
 * - Icon support with proper sizing
 * - Icon-only mode for compact indicators
 * - Text+icon combinations
 * - Custom color overrides
 * - Accessibility-friendly design
 *
 * **Usage:**
 * ```typescript
 * // Text badge
 * <Badge variant="success">Active</Badge>
 *
 * // Icon-only badge
 * <Badge variant="error" icon="fluent:error-circle-16-filled" size={16} />
 *
 * // Text with icon
 * <Badge variant="warning" icon="humbleicons:url" size={12}>
 *   Custom URL
 * </Badge>
 *
 * // Status indicator in avatar
 * <Badge variant="success" icon="fluent:checkmark-16-filled" size={12} />
 * ```
 *
 * @see {@link ./Avatar}
 * @see {@link ./View}
 * @see {@link ./Text}
 */

import * as React from 'react';
import { ViewStyle } from 'react-native';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from './Text';
import { cn } from '@/shared/lib/classNames';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';

/**
 * Shared badge chrome. Every variant renders the same classes — the visual
 * difference is entirely in `getVariantStyles` / `getTextColor` below, which
 * switch on `variant` to pick theme colours.
 *
 * This was a `cva()` call whose six variant entries were all empty strings, so
 * it only ever returned this constant. The class list is unchanged from that
 * call, web-only utilities included.
 */
const BADGE_CLASS =
  'rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2';

type BadgeVariant = 'star' | 'primary' | 'secondary' | 'warning' | 'error' | 'success';

/**
 * Props for the Badge component
 *
 * @interface BadgeProps
 * @description
 * Comprehensive props interface supporting both icon and text content
 * with theme integration and custom styling options.
 */
interface BadgeProps {
  /** Semantic register; drives the colour switches below. */
  variant?: BadgeVariant;
  /** Icon name for the badge (optional) */
  icon?: string;
  /** Size of the badge content in pixels (default: 12) */
  size?: number;
  /** Custom color override for text/icon */
  color?: string;
  /** Additional CSS classes */
  className?: string;
  /** Text content for the badge */
  children?: React.ReactNode;
}

/**
 * Badge component with theme integration and multiple content modes
 *
 * @component
 * @param {BadgeProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Get theme colors → calculate variant styles → determine text color → render with appropriate layout
 * **Effects:** Renders badge with theme-aware colors, proper sizing, and content layout
 *
 * @example
 * // Text badge with success variant
 * <Badge variant="success">Active</Badge>
 *
 * // Icon-only badge for status indicators
 * <Badge variant="error" icon="fluent:error-circle-16-filled" size={16} />
 *
 * // Text with icon (common in mint lists)
 * <Badge variant="warning" icon="humbleicons:url" size={12}>
 *   Custom URL
 * </Badge>
 *
 * // Status indicator in avatar
 * <Badge variant="success" icon="fluent:checkmark-16-filled" size={12} />
 */
function Badge({ className, variant, icon, size = 12, color, children }: BadgeProps) {
  const [
    foreground,
    defaultForeground,
    surfaceSecondary,
    surface,
    danger,
    success,
    warning,
    red500,
    green500,
  ] = useThemeColor([
    'foreground',
    'default-foreground',
    'surface-secondary',
    'surface',
    'danger',
    'success',
    'yellow-300',
    'red-500',
    'green-500',
  ] as const);

  const getVariantStyles = (): ViewStyle => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: withAlpha(defaultForeground, 0.2),
          borderColor: 'transparent',
        };
      case 'secondary':
        return {
          backgroundColor: withAlpha(defaultForeground, 0.2),
          borderColor: 'transparent',
        };
      case 'warning':
        return {
          backgroundColor: withAlpha(danger, 0.2),
          borderColor: 'transparent',
        };
      case 'error':
        return {
          backgroundColor: withAlpha(danger, 0.2),
          borderColor: 'transparent',
        };
      case 'success':
        return {
          backgroundColor: withAlpha(green500, 0.2),
          borderColor: 'transparent',
        };
      case 'star':
        return {
          backgroundColor: withAlpha(warning, 0.2),
          borderColor: 'transparent',
        };
      default:
        return {
          backgroundColor: withAlpha(defaultForeground, 0.2),
          borderColor: 'transparent',
        };
    }
  };

  /**
   * Gets text/icon color based on variant and custom color override
   *
   * @description
   * Determines the appropriate text and icon color for the badge based on the variant.
   * Supports custom color override via the color prop. Uses theme colors for optimal
   * contrast against the variant background colors.
   *
   * **Process:** Check custom color → switch on variant → return theme color
   * **Effects:** Ensures proper contrast and readability for badge content
   *
   * @returns {string} Color string for text and icon content
   *
   * @example
   * getTextColor() // Returns theme color based on variant
   * // With color="red": Returns "red" (custom override)
   * // With variant="success": Returns green theme color
   * // With variant="error": Returns red theme color
   */
  const getTextColor = () => {
    if (color) return color;

    switch (variant) {
      case 'primary':
        return foreground;
      case 'secondary':
        return surfaceSecondary;
      case 'warning':
        return red500;
      case 'error':
        return red500;
      case 'success':
        return success;
      case 'star':
        return warning;
      default:
        return surface;
    }
  };

  // Calculate styles and layout properties
  const variantStyles = getVariantStyles();
  const textColor = getTextColor();
  const isIconOnly = icon && !children;

  return (
    <HStack
      gap={isIconOnly ? 0 : 4}
      className={cn(BADGE_CLASS, className)}
      justify="center"
      align="center"
      blur
      colorBlur={withAlpha(textColor, 0.2)}
      style={{
        ...variantStyles,
        paddingHorizontal: isIconOnly ? 0 : 10, // px-2.5 equivalent
        paddingVertical: isIconOnly ? 0 : 2, // py-0.5 equivalent
        width: isIconOnly ? ((size + 4) as number) : null, // Make it square for icon-only
        height: isIconOnly ? ((size + 4) as number) : null,
      }}>
      {/* Render icon if provided */}
      {icon && <Icon name={icon} size={size} color={textColor} />}
      {/* Render text content if provided */}
      {children && (
        <Text size={size} bold color={textColor}>
          {children}
        </Text>
      )}
    </HStack>
  );
}

export { Badge };
