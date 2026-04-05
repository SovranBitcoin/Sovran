import { Avatar } from '@/shared/ui/primitives/Avatar';
import { UserProfile } from '@/shared/lib/apiClient';
import { Log } from '@/shared/lib/logger';

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

export function ProfileImage({ profile, loading }: ProfileImageProps) {
  return (
    <Log name="ProfileImage">
      <Avatar
        picture={profile?.picture}
        size={48}
        alt={profile?.name || 'User'}
        name={profile?.name}
        loading={loading}
      />
    </Log>
  );
}
