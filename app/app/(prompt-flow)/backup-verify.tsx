import { Stack } from 'expo-router';
import { BackupVerifyScreen } from '@/features/backup/screens/BackupVerifyScreen';
export default function BackupVerifyRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Check your words' }} />
      <BackupVerifyScreen />
    </>
  );
}
