import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { log } from '@/shared/lib/logger';
import { Screen } from '@/shared/ui/composed/Screen';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { useBackupSession } from '../BackupFlowProvider';

export function BackupWordsScreen() {
  const { words, loading, active, ensureWords } = useBackupSession();
  useEffect(() => ensureWords(), [ensureWords]);
  const focused = useIsFocused();
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = fontScale > 1.2 || width < 360;
  const revealed = focused && active && words.length === 12;
  useEffect(() => {
    if (revealed) log.info('backup.flow.revealed');
  }, [revealed]);
  return (
    <Screen
      name="BackupWordsScreen"
      footer={
        <BottomButtons>
          <Button
            testID="backup-written"
            text="I've written them down"
            disabled={!revealed}
            onPress={() => router.push('/(prompt-flow)/backup-verify')}
          />
        </BottomButtons>
      }>
      <View className="gap-6 px-4 py-6">
        <E2EAccessibilityProbe testID="backup-words" accessibilityLabel="Backup words" value="1" />
        <Text size={16}>
          Write them down in order and keep the paper somewhere safe. Next, we&apos;ll check them
          together.
        </Text>
        {loading ? (
          <Text loading placeholder="Loading recovery words" />
        ) : revealed ? (
          <GradientCard>
            <View className="flex-row flex-wrap px-2 py-1">
              {words.map((word, index) => (
                <View
                  key={index}
                  className={
                    singleColumn
                      ? 'min-h-11 w-full justify-center py-2'
                      : 'min-h-11 w-1/3 justify-center py-2'
                  }>
                  <Text
                    testID={`backup-word-${index + 1}`}
                    accessibilityLabel={`Word ${index + 1}, ${word}`}
                    bold>
                    {index + 1}. {word}
                  </Text>
                </View>
              ))}
            </View>
          </GradientCard>
        ) : active && focused ? (
          <Text>Could not load your recovery phrase. Close this screen and try again.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
