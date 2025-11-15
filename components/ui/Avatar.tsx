/**
 * @fileoverview Avatar Component - User and mint avatars with status indicators
 *
 * @module components/ui/Avatar
 *
 * @description
 * **Comprehensive avatar component with multiple variants and status indicators**
 * - Supports both person and mint avatar types
 * - Dynamic status badges with different variants
 * - Fallback content with icons, initials, or generated avatars
 * - Blur effects and theme integration
 * - Responsive sizing and positioning
 *
 * **Features:**
 * - Person avatars (circular) and mint avatars (rounded square)
 * - Status indicators (OK, ERROR, OFFLINE, VERIFIED)
 * - Fallback content with icons, name initials, or seed-based generated avatars
 * - Theme-aware colors and styling
 * - Blur effects for enhanced visual appeal
 *
 * **Usage:**
 * ```typescript
 * // Basic person avatar
 * <Avatar picture="https://example.com/photo.jpg" name="John Doe" />
 *
 * // Generated avatar from seed
 * <Avatar seed="user123pubkey" name="John Doe" />
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

import React, { useState, useEffect } from 'react';
import { BlurView } from 'expo-blur';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle } from 'react-native-svg';

import Icon from 'assets/icons';
import * as AvatarPrimitive from '@rn-primitives/avatar';
import { useTheme } from 'providers/ThemeProvider';
import { rgba } from 'polished';
import { View, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Badge } from './Badge';
import { Skeleton } from './Skeleton';

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
  /** Seed for generating deterministic avatar (e.g., pubkey) */
  seed?: string;
  /** External loading state (e.g., from useSubscribe) */
  loading?: boolean;
}

// ==================== PRNG Implementation ====================

/**
 * Alea PRNG implementation for deterministic random generation
 */
function Alea(seed: string) {
  let me: any = this;
  let mash = Mash();

  me.next = function () {
    let t = 2091639 * me.s0 + me.c * 2.3283064365386963e-10;
    me.s0 = me.s1;
    me.s1 = me.s2;
    return (me.s2 = t - (me.c = t | 0));
  };

  me.c = 1;
  me.s0 = mash(' ');
  me.s1 = mash(' ');
  me.s2 = mash(' ');
  me.s0 -= mash(seed);
  if (me.s0 < 0) {
    me.s0 += 1;
  }
  me.s1 -= mash(seed);
  if (me.s1 < 0) {
    me.s1 += 1;
  }
  me.s2 -= mash(seed);
  if (me.s2 < 0) {
    me.s2 += 1;
  }
  mash = null;
}

function Mash() {
  let n = 0xefc8249d;
  let mash = function (data: string) {
    data = data.toString();
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
  return mash;
}

function rand(seed: string) {
  let xg = new Alea(seed);
  let prng = xg.next.bind(xg);
  prng.double = function () {
    return prng() + ((prng() * 0x200000) | 0) * 1.1102230246251565e-16;
  };
  return prng;
}

/**
 * Generate HSL color from random function
 */
function generateHSLColor(random: () => number, alpha: number = 1): string {
  const h = Math.floor(random() * 360);
  const s = 50 + Math.floor(random() * 30);
  const l = 45 + Math.floor(random() * 20);
  return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

/**
 * Generates a deterministic wave-pattern avatar from a seed
 *
 * @param {string} seed - Seed string (e.g., pubkey)
 * @param {number} size - Size of the avatar in pixels
 * @returns {JSX.Element} SVG avatar component
 */
function generateWavesAvatar(seed: string, size: number): JSX.Element {
  const random = rand(seed || 'default').double;

  // Generate gradient colors
  const color1 = generateHSLColor(random);
  const color2 = generateHSLColor(random);

  // Generate waves
  const waveCount = 4 + Math.floor(random() * 3);
  const baseHue = random() * 360;
  const waves = [];

  for (let i = 0; i < waveCount; i++) {
    const amplitude = size * 0.15 + random() * (size * 0.25); // 15-40% of size
    const frequency = 2 + random() * 3;
    const yOffset = (size / (waveCount + 1)) * (i + 1);
    const phase = random() * Math.PI * 2;

    let pathData = `M 0 ${yOffset} `;
    const step = size / 20; // Dynamic step based on size
    for (let x = 0; x <= size; x += step) {
      const y = yOffset + Math.sin((x / size) * Math.PI * frequency + phase) * amplitude;
      pathData += `L ${x} ${y} `;
    }
    pathData += `L ${size} ${size} L 0 ${size} Z`;

    const hue = (baseHue + (i / waveCount) * 80) % 360;
    const alpha = 0.3 + random() * 0.4;
    const fill = `hsla(${hue}, 65%, 55%, ${alpha})`;

    waves.push({ pathData, fill, key: `wave-${i}` });
  }

  // Generate circular accents
  const circles = [];
  for (let i = 0; i < 0; i++) {
    circles.push({
      cx: random() * size,
      cy: random() * size,
      r: size * 0.1 + random() * (size * 0.15), // 10-25% of size
      fill: `hsla(${baseHue + 180}, 70%, 60%, 0.5)`,
      key: `circle-${i}`,
    });
  }

  return (
    <View style={{ width: size, height: size, overflow: 'hidden', borderRadius: size / 2 }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id={`bg-gradient-${seed}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={color1} />
            <Stop offset="100%" stopColor={color2} />
          </LinearGradient>
        </Defs>

        {/* Background */}
        <Rect width={size} height={size} fill={`url(#bg-gradient-${seed})`} />

        {/* Waves */}
        {waves.map((wave) => (
          <Path key={wave.key} d={wave.pathData} fill={wave.fill} />
        ))}

        {/* Circular accents */}
        {circles.map((circle) => (
          <Circle key={circle.key} cx={circle.cx} cy={circle.cy} r={circle.r} fill={circle.fill} />
        ))}
      </Svg>
    </View>
  );
}

// ==================== Avatar Component ====================

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
 * // Generated avatar from seed
 * <Avatar seed="npub1abc..." name="Alice" />
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
  seed,
  loading: externalLoading = false,
}: AvatarProps) => {
  const { getPrimaryColor } = useTheme();
  const [imageLoading, setImageLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Reset loading and error state when picture changes
  useEffect(() => {
    if (picture) {
      setImageLoading(true);
      setHasError(false);
    } else {
      setImageLoading(false);
      setHasError(false);
    }
  }, [picture]);

  // Combined loading state: external loading (data fetching) OR image loading
  const isLoading = externalLoading || imageLoading;

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
   * Priority: seed (generates avatar) > name (shows initial) > icon (default fallback)
   *
   * For mint avatars with names, shows the first letter. For people or mints without
   * names, shows appropriate icons (user icon for people, coins icon for mints).
   * If seed is provided, generates a unique deterministic avatar.
   *
   * **Process:** Check seed → check variant and name → generate initial or icon → return styled element
   * **Effects:** Provides visual fallback when avatar image fails to load
   *
   * @returns {JSX.Element} Fallback content element (Generated avatar, Text with initial, or Icon)
   *
   * @example
   * // With seed: Shows generated avatar
   * getFallbackContent() // Returns <Svg>...</Svg>
   *
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
    // Priority 1: If seed is provided, generate avatar
    if (seed) {
      return generateWavesAvatar(seed, size);
    }

    // Priority 2: If name is provided and variant is mint, show initial
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
      // Priority 3: Default to icons
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

  // If no picture is provided, just show the seed/fallback version
  const shouldShowImage = picture && !hasError;

  // Show skeleton if loading (either external or image loading)
  const showSkeleton = isLoading;

  // Show fallback (seed/icon) only if not loading or if image failed
  const showFallback = !showSkeleton || hasError;

  return (
    <VStack style={{ position: 'relative' }}>
      {/* Main avatar container using AvatarPrimitive for accessibility */}
      <AvatarPrimitive.Root alt={alt || defaultAlt} style={avatarStyles}>
        {/* Avatar image if available and not errored */}
        {shouldShowImage && (
          <AvatarPrimitive.Image
            source={{ uri: picture }}
            style={avatarStyles}
            onLoad={() => {
              setImageLoading(false);
            }}
            onError={() => {
              setImageLoading(false);
              setHasError(true);
            }}
          />
        )}

        {/* Loading state - show skeleton */}
        {showSkeleton && (
          <Skeleton
            style={{
              ...avatarStyles,
              position: 'absolute',
              zIndex: 10,
            }}
          />
        )}

        {/* Fallback content - show if not loading or if error occurred */}
        {showFallback && (
          <AvatarPrimitive.Fallback style={avatarStyles}>
            <VStack align="center" justify="center" flex={1}>
              {/* Only show blur background if not using generated avatar */}
              {!seed && (
                <BlurView
                  tint="default"
                  style={avatarStyles}
                  intensity={75}
                  className="overflow-hidden opacity-100"
                />
              )}
              {/* Fallback content (generated avatar, initial, or icon) */}
              {getFallbackContent()}
            </VStack>
          </AvatarPrimitive.Fallback>
        )}
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
