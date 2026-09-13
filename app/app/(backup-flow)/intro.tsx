import { Stack } from 'expo-router';
import { BackupIntroScreen } from '@/features/backup/screens/BackupIntroScreen';
export default function BackupIntroRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Back up your wallet' }} />
      <BackupIntroScreen />
    </>
  );
}
