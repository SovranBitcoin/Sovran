/**
 * @fileoverview Avatar Component - User and mint avatars with status indicators
 *
 * @module components/ui/Avatar
 *
 * @description
 * **Comprehensive avatar component with multiple variants and status indicators**
 * - Supports both person and mint avatar types
 * - Dynamic status badges with different variants
 * - Fallback content with icons or initials
 * - Blur effects and theme integration
 * - Responsive sizing and positioning
 *
 * **Features:**
 * - Person avatars (circular) and mint avatars (rounded square)
 * - Status indicators (OK, ERROR, OFFLINE, VERIFIED)
 * - Fallback content with icons or name initials
 * - Theme-aware colors and styling
 * - Blur effects for enhanced visual appeal
 *
 * **Usage:**
 * ```typescript
 * // Basic person avatar
 * <Avatar picture="https://example.com/photo.jpg" name="John Doe" />
 *
 * // Mint avatar with status
 * <Avatar variant="mint" name="Bitcoin Mint" status="OK" />
 *
 * // Avatar with custom size and status
 * <Avatar size={64} status="VERIFIED" picture="https://example.com/verified.jpg" />
 *
 * // Fallback avatar (no picture)
 * <Avatar name="Alice" variant="person" />
 * ```
 *
 * @see {@link ./Badge}
 * @see {@link components/ui/View}
 * @see {@link components/ui/Text}
 */

import React from 'react';
import { BlurView } from 'expo-blur';

import Icon from 'assets/icons';
import * as AvatarPrimitive from '@rn-primitives/avatar';
import { useTheme } from 'providers/ThemeProvider';
import { rgba } from 'polished';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Badge } from './Badge';

/**
 * Avatar variant types
 *
 * @typedef {'person' | 'mint'} AvatarVariant
 * @description
 * - 'person': Circular avatar for users/people
 * - 'mint': Rounded square avatar for mint services
 */
type AvatarVariant = 'person' | 'mint';

/**
 * Props for the Avatar component
 *
 * @interface AvatarProps
 * @description
 * Comprehensive props interface for the Avatar component supporting
 * both person and mint variants with optional status indicators.
 */
interface AvatarProps {
  /** Image URL for the avatar picture */
  picture?: string;
  /** Size of the avatar in pixels (default: 48) */
  size?: number;
  /** Avatar variant - person (circular) or mint (rounded square) */
  variant?: AvatarVariant;
  /** Alt text for accessibility */
  alt?: string;
  /** Name for fallback content and accessibility */
  name?: string;
  /** Status indicator (OK, ERROR, OFFLINE, VERIFIED) */
  status?: string;
}

/**
 * Avatar component with multiple variants and status indicators
 *
 * @component
 * @param {AvatarProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Calculate sizes → determine border radius → get status config → render avatar with fallback
 * **Effects:** Renders avatar with appropriate styling, status badges, and fallback content
 *
 * @example
 * // Basic person avatar
 * <Avatar picture="https://example.com/photo.jpg" name="John Doe" />
 *
 * // Mint avatar with status
 * <Avatar variant="mint" name="Bitcoin Mint" status="OK" size={64} />
 *
 * // Verified user avatar
 * <Avatar name="Alice" status="VERIFIED" variant="person" />
 *
 * // Error state mint
 * <Avatar variant="mint" name="Failed Mint" status="ERROR" />
 */
export const Avatar = ({
  picture,
  size = 48,
  variant = 'person',
  alt,
  name,
  status,
}: AvatarProps) => {
  const { getPrimaryColor } = useTheme();
  const iconSize = size * 0.5; // 50% of parent size
  const statusIconSize = size * 0.33; // 25% of parent size for status icon

  // Different border radius based on variant
  const borderRadius =
    variant === 'person'
      ? size / 2 // Perfect circle for people
      : size * 0.25; // Square rounded for mints (25% of size)

  /**
   * Gets status badge configuration based on status string
   *
   * @description
   * Maps status strings to badge configurations including variant, icon, and whether
   * to show a badge background. Supports OK, ERROR, OFFLINE, and VERIFIED statuses.
   *
   * @returns {Object|null} Status configuration object or null if no status
   * @returns {string} returns.variant - Badge variant ('success', 'error', 'secondary')
   * @returns {string} returns.icon - Icon name for the status
   * @returns {boolean} returns.badge - Whether to show badge background
   *
   * @example
   * getStatusBadge() // Returns null if no status
   * // With status="OK" returns: { variant: 'success', icon: 'fluent:checkmark-16-filled', badge: true }
   * // With status="VERIFIED" returns: { variant: 'success', icon: 'material-symbols:verified-rounded', badge: false }
   */
  const getStatusBadge = () => {
    if (!status) return null;

    const statusConfig: Record<
      string,
      { variant: 'success' | 'error' | 'secondary'; icon: string; badge: boolean }
    > = {
      OK: {
        variant: 'success' as const,
        icon: 'fluent:checkmark-16-filled',
        badge: true,
      },
      ERROR: {
        variant: 'error' as const,
        icon: 'nonicons:error-16',
        badge: true,
      },
      OFFLINE: {
        variant: 'secondary' as const,
        icon: 'feather:wifi',
        badge: true,
      },
      VERIFIED: {
        variant: 'success' as const,
        icon: 'material-symbols:verified-rounded',
        badge: false, // No badge background for verified
      },
    };

    return statusConfig[status];
  };

  const avatarStyles = {
    width: size,
    height: size,
    borderRadius,
  };

  /**
   * Generates fallback content when no picture is available
   *
   * @description
   * Creates appropriate fallback content based on avatar variant and available props.
   * For mint avatars with names, shows the first letter. For people or mints without
   * names, shows appropriate icons (user icon for people, coins icon for mints).
   *
   * **Process:** Check variant and name → generate initial or icon → return styled element
   * **Effects:** Provides visual fallback when avatar image fails to load
   *
   * @returns {JSX.Element} Fallback content element (Text with initial or Icon)
   *
   * @example
   * // Mint with name: Shows "B" for "Bitcoin Mint"
   * getFallbackContent() // Returns <Text>B</Text>
   *
   * // Person without name: Shows user icon
   * getFallbackContent() // Returns <Icon name="ph:user-bold" />
   *
   * // Mint without name: Shows coins icon
   * getFallbackContent() // Returns <Icon name="majesticons:coins" />
   */
  const getFallbackContent = () => {
    if (variant === 'mint' && name) {
      // For mints, show the first letter of the name
      const initial = name.charAt(0).toUpperCase();
      return (
        <Text
          className="text-primary-300/75"
          size={iconSize}
          bold
          overpass
          style={{
            position: 'absolute',
          }}>
          {initial}
        </Text>
      );
    } else {
      // For people or mints without name, show icon
      const fallbackIcon =
        variant === 'person'
          ? 'ph:user-bold' // User icon for people
          : 'majesticons:coins'; // Coins icon for mints
      return (
        <Icon
          name={fallbackIcon}
          color={rgba(getPrimaryColor('300'), 0.75)}
          size={iconSize}
          style={{
            position: 'absolute',
          }}
        />
      );
    }
  };

  // Generate appropriate alt text for accessibility
  const defaultAlt = variant === 'person' ? 'User Avatar' : 'Mint Avatar';

  // Get status badge configuration
  const statusBadge = getStatusBadge();

  return (
    <VStack style={{ position: 'relative' }}>
      {/* Main avatar container using AvatarPrimitive for accessibility */}
      <AvatarPrimitive.Root alt={alt || defaultAlt} style={avatarStyles}>
        {/* Avatar image if available */}
        {picture && <AvatarPrimitive.Image source={{ uri: picture }} style={avatarStyles} />}

        {/* Fallback content when image fails to load */}
        <AvatarPrimitive.Fallback style={avatarStyles}>
          <VStack align="center" justify="center" flex={1}>
            {/* Blur background for visual appeal */}
            <BlurView
              tint="default"
              style={avatarStyles}
              intensity={75}
              className="overflow-hidden opacity-100"
            />
            {/* Fallback content (initial or icon) */}
            {getFallbackContent()}
          </VStack>
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>

      {/* Status badge positioned in bottom right corner */}
      {statusBadge && (
        <VStack
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            zIndex: 50,
          }}>
          {/* Render badge with background or just icon based on configuration */}
          {statusBadge.badge ? (
            <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={statusIconSize} />
          ) : (
            <Icon name={statusBadge.icon} size={statusIconSize} />
          )}
        </VStack>
      )}
    </VStack>
  );
};
