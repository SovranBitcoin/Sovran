import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { useBackupSession } from '../BackupFlowProvider';

export function BackupIntroScreen() {
  const { demo } = useBackupSession();
  return (
    <Screen
      name="BackupIntroScreen"
      footer={
        <BottomButtons>
          <Button
            testID="backup-show-words"
            text="Show my words"
            onPress={() => router.push('/(backup-flow)/words')}
          />
          <Button
            testID="backup-not-now"
            text="Not now"
            variant="secondary"
            onPress={() => {
              if (!demo) useCtaStore.getState().dismiss('backup-recovery-phrase', false);
              router.dismiss();
            }}
          />
        </BottomButtons>
      }>
      <View testID="backup-intro" className="gap-6 px-4 py-6">
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
