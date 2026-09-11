import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { npubEncode } from 'nostr-tools/nip19';
import { Button } from 'heroui-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { ProfileDetailsScreen } from '../components/ProfileDetailsScreen';
import { readRecoveryInformation, type RecoveryInformation } from '../lib/readRecoveryInformation';

/** Reads existing storage without mounting the normal key-initialization or profile-fetch hooks. */
export function SettingsProfileRecoveryScreen({ onBack }: { onBack: () => void }) {
  const profiles = useProfileStore((s) => s.profiles);
  const [profile, setProfile] = useState<ProfileEntry | null>(null);
  return (
    <RecoveryDetails
      key={profile?.pubkey ?? 'root'}
      profile={profile}
      onBack={onBack}
      selection={
        <VStack className="mb-4 gap-2">
          <Text bold>Recovery information</Text>
          <Text>
            Choose a profile to view its existing keys. This does not switch your wallet or accept
            the documents.
          </Text>
          <Button variant="secondary" isDisabled={!profile} onPress={() => setProfile(null)}>
            <Button.Label>Root recovery phrase</Button.Label>
          </Button>
          {profiles.map((entry) => (
            <Button
              key={entry.pubkey}
              variant="secondary"
              isDisabled={profile?.pubkey === entry.pubkey}
              onPress={() => setProfile(entry)}>
              <Button.Label>
                {entry.cachedDisplayName || `Profile ${entry.accountIndex}`}
              </Button.Label>
            </Button>
          ))}
          <Text className="text-muted">
            Keys alone may not recover all ecash. Keep this installation, mint information and
            wallet backups. This page does not export proofs or transfer funds.
          </Text>
        </VStack>
      }
    />
  );
}

function RecoveryDetails({
  profile,
  onBack,
  selection,
}: {
  profile: ProfileEntry | null;
  onBack: () => void;
  selection: React.ReactNode;
}) {
  const [information, setInformation] = useState<RecoveryInformation | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef({ generation: 0 });
  useEffect(() => {
    const pending = request.current;
    const generation = ++pending.generation;
    setLoading(true);
    setFailed(false);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        pending.generation++;
        setInformation(null);
        setLoading(false);
      }
    });
    void readRecoveryInformation(profile).then(
      (value) => {
        if (generation === pending.generation) {
          setInformation(value);
          setLoading(false);
        }
      },
      () => {
        if (generation === pending.generation) {
          setFailed(true);
          setLoading(false);
        }
      }
    );
    return () => {
      pending.generation++;
      subscription.remove();
    };
  }, [profile, attempt]);
  const keys =
    profile && information?.nsec
      ? {
          pubkey: profile.pubkey,
          npub: npubEncode(profile.pubkey),
          nsec: information.nsec,
        }
      : null;
  return (
    <ProfileDetailsScreen
      mnemonic={information?.mnemonic ?? null}
      nostrKeys={keys}
      cashuMnemonic={information?.cashuMnemonic ?? null}
      loading={loading}
      activeProfile={profile ?? undefined}
      rootOnly={!profile}
      username={
        profile?.cachedDisplayName ||
        (profile ? `Profile ${profile.accountIndex}` : 'Root recovery phrase')
      }
      onBack={onBack}>
      {selection}
      {!information && !loading && (
        <VStack className="mb-4 gap-2">
          <Text>
            {failed
              ? 'Could not read verified recovery information. Keep this installation and your backups.'
              : 'Recovery information was cleared when the app left the foreground.'}
          </Text>
          <Button variant="secondary" onPress={() => setAttempt((value) => value + 1)}>
            <Button.Label>Reload recovery information</Button.Label>
          </Button>
        </VStack>
      )}
    </ProfileDetailsScreen>
  );
}
