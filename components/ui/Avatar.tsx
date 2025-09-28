import React from 'react';
import { BlurView } from 'expo-blur';
import { useSelector } from 'react-redux';

import Icon from 'assets/icons';
import * as AvatarPrimitive from '@rn-primitives/avatar';
import { memoizedGetTheme } from 'helper/redux/settings';
import { rgba } from 'polished';
import { VStack } from 'components/ui/View';

export const Avatar = ({ picture, size = 48 }: { picture: string; size?: number }) => {
  const theme = useSelector(memoizedGetTheme);
  const iconSize = size * 0.5; // 50% of parent size

  const avatarStyles = {
    width: size,
    height: size,
    borderRadius: size / 2, // Perfect circle based on size
  };

  return (
    <AvatarPrimitive.Root alt="User Avatar" style={avatarStyles}>
      {picture && <AvatarPrimitive.Image source={{ uri: picture }} style={avatarStyles} />}
      <AvatarPrimitive.Fallback style={avatarStyles}>
        <VStack align="center" justify="center" flex={1}>
          <BlurView
            tint="default"
            style={avatarStyles}
            intensity={75}
            className="overflow-hidden opacity-100"
          />
          <Icon
            name="ph:user-bold"
            color={rgba(theme.greys[300], 0.75)}
            size={iconSize}
            style={{
              position: 'absolute',
            }}
          />
        </VStack>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
};
