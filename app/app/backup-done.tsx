import { Stack } from 'expo-router';
import { BackupDoneScreen } from '@/features/backup/screens/BackupDoneScreen';
export default function BackupDoneRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Backup done' }} />
      <BackupDoneScreen />
    </>
  );
}
