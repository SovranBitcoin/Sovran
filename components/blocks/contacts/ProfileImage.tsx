import { Avatar } from 'components/ui/Avatar';
import { UserProfile } from 'helper/apiClient';

interface ProfileImageProps {
  profile: UserProfile | undefined;
  loading: boolean;
}

export function ProfileImage({ profile, loading }: ProfileImageProps) {
  return (
    <Avatar
      picture={profile?.picture}
      size={48}
      variant="person"
      alt={profile?.name || 'User'}
      name={profile?.name}
      loading={loading}
    />
  );
}
