import { Stack } from 'expo-router';
import { BackupWordsScreen } from '@/features/backup/screens/BackupWordsScreen';
export default function BackupWordsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Recovery words' }} />
      <BackupWordsScreen />
    </>
  );
}
