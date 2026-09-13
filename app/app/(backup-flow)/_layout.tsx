import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '@/config/flowLayoutOptions';
import { BackupFlowProvider } from '@/features/backup/BackupFlowProvider';
export default function BackupFlowLayout() {
  return (
    <BackupFlowProvider>
      <AndroidSheetFlowStack>
        <Stack.Screen name="index" />
      </AndroidSheetFlowStack>
    </BackupFlowProvider>
  );
}
