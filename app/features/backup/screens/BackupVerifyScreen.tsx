import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { log } from '@/shared/lib/logger';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { useBackupSession } from '../BackupFlowProvider';
import { advanceVerify } from '../lib/verifyPlan';

export function BackupVerifyScreen() {
  const { plan, progress, setProgress, active, loading } = useBackupSession();
  const focused = useIsFocused();
  const successForeground = useThemeColor('success-foreground');
  const [accepted, setAccepted] = useState(false);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offset = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const visible = focused && active;
  useEffect(() => {
    if (visible) log.info('backup.flow.verify_started');
    return () => {
      if (timer.current) clearTimeout(timer.current);
      locked.current = false;
    };
  }, [visible]);
  useEffect(() => {
    if (!visible) setAccepted(false);
  }, [visible]);
  const question = plan[progress.position];
  const pick = (index: number) => {
    if (locked.current || !visible || !question) return;
    const result = advanceVerify(
      { ...progress, answerIndices: plan.map((entry) => entry.answerIndex) },
      index
    );
    if (result.outcome === 'wrong') {
      setProgress(result.state);
      log.info('backup.flow.verify_wrong', { position: question.position });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      offset.set(
        withSequence(
          ReduceMotion.System,
          withTiming(-8, { duration: 70 }),
          withTiming(8, { duration: 70 }),
          withTiming(0, { duration: 70 })
        )
      );
      return;
    }
    locked.current = true;
    setAccepted(true);
    timer.current = setTimeout(() => {
      setProgress(result.state);
      setAccepted(false);
      locked.current = false;
      if (result.outcome === 'complete') router.replace('/(backup-flow)/done');
    }, 250);
  };
  return (
    <Screen name="BackupVerifyScreen">
      <View className="gap-6 px-4 py-6">
        <E2EAccessibilityProbe testID="backup-verify" accessibilityLabel="Backup verify" value="1" />
        <Text size={24} bold>
          Quick check
        </Text>
        {loading ? (
          <Text loading placeholder="Loading quick check" />
        ) : visible && question ? (
          <>
            <Text accessibilityLiveRegion="polite">
              Tap word {question.position} from your paper.
            </Text>
            <Text testID="backup-verify-progress" accessibilityLabel={`${question.position} of 12`}>
              {question.position} of 12
            </Text>
            <View
              className="flex-row gap-1"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              {plan.map((entry, index) => (
                <View
                  key={entry.position}
                  className={`h-6 flex-1 items-center justify-center rounded-sm ${index < progress.position || (accepted && index === progress.position) ? 'bg-success' : 'bg-surface-secondary'}`}>
                  {accepted && index === progress.position && (
                    <Icon name="mdi:check" size={16} color={successForeground} />
                  )}
                </View>
              ))}
            </View>
            <Animated.View style={shakeStyle}>
              <View className="gap-3">
                {question.choices.map((word, index) => (
                  <Button
                    key={index}
                    testID={`backup-choice-${index}`}
                    text={word}
                    accessibilityLabel={`Option ${index + 1}, ${word}`}
                    variant="secondary"
                    disabled={accepted}
                    onPress={() => pick(index)}
                  />
                ))}
              </View>
            </Animated.View>
            {progress.missesAtPosition > 0 && !accepted && (
              <Text accessibilityRole="alert">
                Not quite — look at word {question.position} on your paper.
              </Text>
            )}
            {progress.missesAtPosition >= 2 && (
              <Button
                testID="backup-show-again"
                text="Show my words again"
                variant="underline"
                disabled={accepted}
                onPress={() => router.back()}
              />
            )}
          </>
        ) : active && focused ? (
          <Text>Could not load your recovery phrase. Close this screen and try again.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
