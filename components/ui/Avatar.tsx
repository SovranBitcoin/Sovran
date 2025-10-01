import React from 'react';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';

import Icon from 'assets/icons';
import * as AvatarPrimitive from '@rn-primitives/avatar';
import { memoizedGetTheme } from 'helper/redux/settings';
import { rgba } from 'polished';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Badge } from './Badge';

type AvatarVariant = 'person' | 'mint';

interface AvatarProps {
  picture?: string;
  size?: number;
  variant?: AvatarVariant;
  alt?: string;
  name?: string;
  status?: string;
}

export const Avatar = ({
  picture,
  size = 48,
  variant = 'person',
  alt,
  name,
  status,
}: AvatarProps) => {
  const theme = useSelector(memoizedGetTheme);
  const iconSize = size * 0.5; // 50% of parent size
  const statusIconSize = size * 0.33; // 25% of parent size for status icon

  // Different border radius based on variant
  const borderRadius =
    variant === 'person'
      ? size / 2 // Perfect circle for people
      : size * 0.25; // Square rounded for mints (25% of size)

  // Status badge configuration
  const getStatusBadge = () => {
    if (!status) return null;

    const statusConfig = {
      OK: {
        variant: 'success' as const,
        icon: 'fluent:checkmark-16-filled',
      },
      ERROR: {
        variant: 'error' as const,
        icon: 'nonicons:error-16',
      },
      OFFLINE: {
        variant: 'secondary' as const,
        icon: 'feather:wifi',
      },
    };

    return statusConfig[status];
  };

  const avatarStyles = {
    width: size,
    height: size,
    borderRadius,
  };

  // Different fallback content based on variant
  const getFallbackContent = () => {
    if (variant === 'mint' && name) {
      // For mints, show the first letter of the name
      const initial = name.charAt(0).toUpperCase();
      return (
        <Text
          style={{
            color: rgba(theme.greys[300], 0.75),
            fontSize: iconSize,
            fontWeight: 'bold',
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
          : 'material-symbols:account-balance'; // Bank/mint icon for mints
      return (
        <Icon
          name={fallbackIcon}
          color={rgba(theme.greys[300], 0.75)}
          size={iconSize}
          style={{
            position: 'absolute',
          }}
        />
      );
    }
  };

  const defaultAlt = variant === 'person' ? 'User Avatar' : 'Mint Avatar';

  const statusBadge = getStatusBadge();

  return (
    <VStack style={{ position: 'relative' }}>
      <AvatarPrimitive.Root alt={alt || defaultAlt} style={avatarStyles}>
        {picture && <AvatarPrimitive.Image source={{ uri: picture }} style={avatarStyles} />}
        <AvatarPrimitive.Fallback style={avatarStyles}>
          <VStack align="center" justify="center" flex={1}>
            <BlurView
              tint="default"
              style={avatarStyles}
              intensity={75}
              className="overflow-hidden opacity-100"
            />
            {getFallbackContent()}
          </VStack>
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>

      {/* Status badge in bottom right corner */}
      {statusBadge && (
        <VStack
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
          }}>
          <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={statusIconSize} />
        </VStack>
      )}
    </VStack>
  );
};
