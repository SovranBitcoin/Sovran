import React, { useState, useCallback } from 'react';
import { Image } from 'react-native';
import { View } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import Icon from 'assets/icons';
import { Skeleton } from 'react-native-skeleton-component';
import { UserProfile } from 'helper/apiClient';

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

export function ProfileImage({ profile, loading }: ProfileImageProps) {
  const theme = useSelector(memoizedGetTheme);
  const [imageError, setImageError] = useState(false);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  return (
    <Skeleton style={{ width: 48, height: 48, borderRadius: 24 }}>
      {!loading && (
        <>
          {profile?.picture && !imageError ? (
            <Image
              source={{ uri: profile.picture }}
              onError={handleImageError}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
              }}
            />
          ) : (
            <View
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: greys(theme)[950] }}>
              <Icon name="ph:user-bold" size={24} color={greys(theme)[400]} />
            </View>
          )}
        </>
      )}
    </Skeleton>
  );
}
