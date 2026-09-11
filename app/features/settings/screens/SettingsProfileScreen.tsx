import { useMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { ProfileDetailsScreen } from '../components/ProfileDetailsScreen';

export function SettingsProfileScreen() {
  const { value: mnemonic, loading } = useMnemonic();
  const { keys, cashuMnemonic, isLoading } = useNostrKeysContext();
  const { displayName, picture } = useProfileDisplay(keys?.pubkey || '');
  const profile = useProfileStore((s) => s.getActiveProfile());
  return (
    <ProfileDetailsScreen
      key={profile?.pubkey ?? 'root'}
      mnemonic={mnemonic}
      nostrKeys={keys}
      cashuMnemonic={cashuMnemonic}
      loading={loading || isLoading}
      activeProfile={profile}
      username={displayName}
      profilePicture={picture}
    />
  );
}
