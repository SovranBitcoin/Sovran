import React, { useState, useCallback } from 'react';
import { Image } from 'react-native';
import { View } from 'components/ui/View';
import Icon from 'assets/icons';
import { Skeleton } from 'react-native-skeleton-component';
import { UserProfile } from 'helper/apiClient';

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

export function ProfileImage({ profile, loading }: ProfileImageProps) {
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
            <View className="bg-primary-950 h-12 w-12 items-center justify-center rounded-full">
              <Icon name="ph:user-bold" size={24} className="text-primary-400" />
            </View>
          )}
        </>
      )}
    </Skeleton>
  );
}
