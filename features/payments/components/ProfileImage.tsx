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
        state={loading ? 'loading' : profile?.picture ? 'image' : 'fallback'}
        picture={profile?.picture}
        size={48}
        alt={profile?.name || 'User'}
        name={profile?.name}
      />
    </Log>
  );
}
