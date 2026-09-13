import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { useEffect } from 'react';
import { useNavigation } from 'expo-router';
import { useBackupSession } from '../BackupFlowProvider';

export function BackupIntroScreen() {
  const { demo, open } = useBackupSession();
  const navigation = useNavigation();
  useEffect(() => open(), [open]);
  return (
    <Screen
      name="BackupIntroScreen"
      footer={
        <BottomButtons>
          <Button
            testID="backup-show-words"
            text="Show my words"
            onPress={() => router.push('/(prompt-flow)/backup-words')}
          />
          <Button
            testID="backup-not-now"
            text="Not now"
            variant="secondary"
            onPress={() => {
              if (!demo) useCtaStore.getState().dismiss('backup-recovery-phrase', false);
              // Close the whole prompt flow, not just this page (a prompt may sit beneath).
              navigation.getParent()?.goBack();
            }}
          />
        </BottomButtons>
      }>
      <View className="gap-6 px-4 py-6">
        <E2EAccessibilityProbe testID="backup-intro" accessibilityLabel="Backup intro" value="1" />
        <Text size={24} bold>
          Back up your wallet
        </Text>
        {demo && (
          <Text testID="backup-demo">
            Mock Mode — practice words only. This does not back up your wallet.
          </Text>
        )}
        <Text>
          Your wallet has 12 recovery words. They&apos;re the only way to get your money back if you
          lose this phone. Write them on paper — not a screenshot, not a note. Anyone with the words
          has your money. They can&apos;t be changed or reset.
        </Text>
      </View>
    </Screen>
  );
}
