import { Avatar } from '@/shared/ui/primitives/Avatar';
import { UserProfile } from '@/shared/lib/apiClient';

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

export function ProfileImage({ profile, loading }: ProfileImageProps) {
  return (
    <Avatar
      picture={profile?.picture}
      size={48}
      alt={profile?.name || 'User'}
      name={profile?.name}
      loading={loading}
    />
  );
}
