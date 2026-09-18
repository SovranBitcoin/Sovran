import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import Icon from '@/assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import { ListGroup, PressableFeedback, Separator } from 'heroui-native';
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
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { useBackupSession } from '../BackupFlowProvider';
import { advanceVerify } from '../lib/verifyPlan';

/** One row per position: fills as the user gets each word right. */
function StepProgress({
  total,
  done,
  accepted,
}: {
  total: number;
  done: number;
  accepted: boolean;
}) {
  return (
    <View
      className="flex-row gap-1"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          className={`h-1.5 flex-1 rounded-full ${index < done || (accepted && index === done) ? 'bg-success' : 'bg-surface-secondary'}`}
        />
      ))}
    </View>
  );
}

export function BackupVerifyScreen() {
  const { plan, progress, setProgress, active, loading, ensureWords } = useBackupSession();
  useEffect(() => ensureWords(), [ensureWords]);
  const focused = useIsFocused();
  const [muted, success] = useThemeColor(['muted', 'success'] as const);
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
      if (result.outcome === 'complete') router.replace('/(prompt-flow)/backup-done');
    }, 250);
  };
  return (
    <Screen name="BackupVerifyScreen">
      <View className="gap-5 px-4 py-6">
        <E2EAccessibilityProbe
          testID="backup-verify"
          accessibilityLabel="Backup verify"
          value="1"
        />
        {loading ? (
          <Text loading placeholder="Loading your words" />
        ) : visible && question ? (
          <Fragment>
            <View className="gap-3">
              <View className="flex-row items-baseline justify-between">
                <Text size={18} medium accessibilityLiveRegion="polite">
                  Tap word {question.position} from your paper
                </Text>
                <Text
                  testID="backup-verify-progress"
                  accessibilityLabel={`${question.position} of 12`}
                  size={13}
                  className="text-muted">
                  {question.position} of 12
                </Text>
              </View>
              <StepProgress total={12} done={progress.position} accepted={accepted} />
            </View>
            <Animated.View style={shakeStyle}>
              <GradientCard>
                <ListGroup>
                  {question.choices.map((word, index) => (
                    <Fragment key={index}>
                      {index > 0 ? <Separator className="mx-4" /> : null}
                      {/* Choice slots have no identity beyond their position, and the
                          words are secret, so the slot number is the testID. */}
                      <PressableFeedback
                        testID={`backup-choice-${index}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Option ${index + 1}, ${word}`}
                        accessibilityState={{
                          disabled: accepted,
                          selected: accepted && index === question.answerIndex,
                        }}
                        isDisabled={accepted}
                        onPress={() => pick(index)}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{word}</ListGroup.ItemTitle>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <Icon
                                name={
                                  accepted && index === question.answerIndex
                                    ? 'mdi:check-circle'
                                    : 'mdi:circle-outline'
                                }
                                size={22}
                                color={accepted && index === question.answerIndex ? success : muted}
                              />
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    </Fragment>
                  ))}
                </ListGroup>
              </GradientCard>
            </Animated.View>
            {progress.missesAtPosition > 0 && !accepted ? (
              <Text accessibilityRole="alert" size={14} className="text-muted">
                Not quite — look at word {question.position} on your paper.
              </Text>
            ) : null}
            {progress.missesAtPosition >= 2 ? (
              <Button
                testID="backup-show-again"
                text="Show my words again"
                variant="underline"
                disabled={accepted}
                onPress={() => router.back()}
              />
            ) : null}
          </Fragment>
        ) : active && focused ? (
          <Text>Could not load your recovery phrase. Close this screen and try again.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
