import React from 'react';
import { View } from 'react-native';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Text } from 'components/ui/Text';
import { GradientSkeleton } from 'components/ui/GradientSkeleton';
import { useNostrProfile } from 'app/ProfilePage/helper';
import CachedImage from 'components/ui/Image';
import { memoizedGetTheme } from 'helper/redux/settings';

interface ProfileIconProps {
  pubkey: string;
}

export function ProfileIcon({ pubkey }: ProfileIconProps) {
  const theme = useSelector(memoizedGetTheme);
  const profile = useNostrProfile({ id: pubkey });
  const [imageLoading, setImageLoading] = React.useState(true);

  return (
    <View
      style={{
        width: 48,
        height: 48,
        backgroundColor: greys(theme)[700],
        borderRadius: 16111,
        marginRight: 8,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      {profile?.picture ? (
        <>
          {imageLoading && (
            <GradientSkeleton
              startColor={greys(theme)[700]}
              endColor={greys(theme)[600]}
              width={48}
              height={48}
              style={{
                position: 'absolute',
                borderRadius: 16111,
              }}
            />
          )}
          <CachedImage
            style={{
              width: 48,
              height: 48,
            }}
            source={{ uri: profile?.picture }}
            onLoadStart={() => setImageLoading(true)}
            onLoadEnd={() => setImageLoading(false)}
          />
        </>
      ) : (
        // Show first letter of username if no picture
        <Text
          style={{
            fontSize: 20,
            color: greys(theme)[100],
            fontFamily: 'OverpassBold',
          }}>
          {(profile?.displayName || profile?.name || 'A')?.[0]?.toUpperCase()}
        </Text>
      )}
    </View>
  );
}
