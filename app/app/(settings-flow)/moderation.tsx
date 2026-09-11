import { SettingsModerationScreen } from '@/features/settings/screens/SettingsModerationScreen';
import { useProfileStore } from '@/shared/stores/global/profileStore';

export default function ModerationRoute() {
  const account = useProfileStore((s) => {
    const profile = s.profiles.find((entry) => entry.accountIndex === s.activeAccountIndex);
    return `${s.activeAccountIndex}:${profile?.pubkey ?? ''}`;
  });
  return <SettingsModerationScreen key={account} />;
}
