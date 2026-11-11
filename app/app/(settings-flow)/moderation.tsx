import { SettingsModerationScreen } from '@/features/settings/screens/SettingsModerationScreen';
import { selectActivePubkey, useProfileStore } from '@/shared/stores/global/profileStore';

export default function ModerationRoute() {
  const account = useProfileStore((s) => `${s.activeAccountIndex}:${selectActivePubkey(s) ?? ''}`);
  return <SettingsModerationScreen key={account} />;
}
