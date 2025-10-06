import React from 'react';
import { Avatar } from 'components/ui/Avatar';
import { Skeleton } from 'react-native-skeleton-component';
import { UserProfile } from 'helper/apiClient';

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

export function ProfileImage({ profile, loading }: ProfileImageProps) {
  return (
    <Skeleton style={{ width: 48, height: 48, borderRadius: 24 }}>
      {!loading && (
        <Avatar
          picture={profile?.picture}
          size={48}
          variant="person"
          alt={profile?.name || 'User'}
        />
      )}
    </Skeleton>
  );
}
