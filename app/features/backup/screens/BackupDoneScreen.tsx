import { useEffect, useRef } from 'react';
import { Redirect, useNavigation } from 'expo-router';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { log } from '@/shared/lib/logger';
import { Screen } from '@/shared/ui/composed/Screen';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { useBackupSession } from '../BackupFlowProvider';

export function BackupDoneScreen() {
  const { progress, demo, finish } = useBackupSession();
  const navigation = useNavigation();
  const marked = useRef(false);
  useEffect(() => {
    if (progress.position !== 12 || marked.current) return;
    marked.current = true;
    if (!demo) useWalletLifecycleStore.getState().markRecoveryPhraseVerified();
    finish();
    log.info('backup.flow.verify_complete');
  }, [progress.position, demo, finish]);
  if (progress.position !== 12) return <Redirect href="/(backup-flow)" />;
  return (
    <Screen
      name="BackupDoneScreen"
      footer={
        <BottomButtons>
          <Button
            testID="backup-done-button"
            text="Done"
            onPress={() => navigation.getParent()?.goBack()}
          />
        </BottomButtons>
      }>
      <View testID="backup-done" className="gap-6 px-4 py-6">
        <Text size={24} bold>
          Backup done
        </Text>
        <Text>
          {demo
            ? 'Practice complete. Your real wallet has not been marked as backed up.'
            : "Your 12 words match. Keep that paper safe and private — it's now the key to this wallet."}
        </Text>
      </View>
    </Screen>
  );
}
