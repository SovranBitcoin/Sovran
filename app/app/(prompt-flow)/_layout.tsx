import { Stack } from 'expo-router';
import { AndroidSheetFlowStack } from '@/config/flowLayoutOptions';
import { BackupFlowProvider } from '@/features/backup/BackupFlowProvider';
/** Prompts and the backup flow share one modal stack, so "Back up now" pushes
 * the next page instead of presenting a second modal. */
export default function PromptFlowLayout() {
  return (
    <BackupFlowProvider>
      <AndroidSheetFlowStack>
        {/* Same header chrome as every other flow page: the shared close
            action on the left. CtaScreen removes it while a prompt blocks. */}
        <Stack.Screen name="cta" options={{ title: '' }} />
      </AndroidSheetFlowStack>
    </BackupFlowProvider>
  );
}
