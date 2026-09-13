import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '@/config/flowLayoutOptions';
import { BackupFlowProvider } from '@/features/backup/BackupFlowProvider';
/** Prompts and the backup flow share one modal stack, so "Back up now" pushes
 * the next page instead of presenting a second modal. */
export default function PromptFlowLayout() {
  return (
    <BackupFlowProvider>
      <AndroidSheetFlowStack>
        <Stack.Screen name="cta" options={{ headerShown: false }} />
      </AndroidSheetFlowStack>
    </BackupFlowProvider>
  );
}
