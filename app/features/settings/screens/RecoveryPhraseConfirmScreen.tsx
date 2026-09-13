import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useIsFocused } from 'expo-router/react-navigation';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  ReduceMotion,
} from 'react-native-reanimated';
import { useMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { Button } from '@/shared/ui/primitives/Button';
import { createRecoveryChallenge, type RecoveryQuestion } from '../lib/recoveryPhraseChallenge';

export function RecoveryPhraseQuiz({
  questions,
  onComplete,
}: {
  questions: RecoveryQuestion[];
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);
  const [incorrect, setIncorrect] = useState(false);
  const completed = useRef(false);
  const offset = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const question = questions[step];
  if (!question) return <Text>Could not load your recovery phrase. Go back and try again.</Text>;
  const pick = (word: string) => {
    if (completed.current) return;
    if (word !== question.answer) {
      setIncorrect(true);
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
    setIncorrect(false);
    if (step === questions.length - 1) {
      completed.current = true;
      onComplete();
    } else setStep(step + 1);
  };
  return (
    <View testID="recovery-phrase-confirm" className="gap-6 px-4 py-6">
      <Text size={24} bold>
        Check your recovery phrase
      </Text>
      <Text>Choose word {question.position} from your written backup.</Text>
      <Text className="text-foreground/70">
        {step + 1} of {questions.length}
      </Text>
      <Animated.View style={shakeStyle}>
        <View className="flex-row flex-wrap gap-3">
          {question.choices.map((word, index) => (
            <View key={index} className="w-[45%] grow">
              <Button
                testID={`recovery-choice-${index}`}
                text={word}
                variant="secondary"
                onPress={() => pick(word)}
              />
            </View>
          ))}
        </View>
      </Animated.View>
      {incorrect && (
        <Text testID="recovery-phrase-incorrect" accessibilityRole="alert">
          That word does not match. Check your backup and try again.
        </Text>
      )}
    </View>
  );
}
function LoadedQuiz({ mnemonic }: { mnemonic: string }) {
  const [questions] = useState(() => createRecoveryChallenge(mnemonic));
  return (
    <RecoveryPhraseQuiz
      questions={questions}
      onComplete={() => {
        useWalletLifecycleStore.getState().markRecoveryPhraseVerified();
        router.back();
      }}
    />
  );
}
export function RecoveryPhraseConfirmScreen() {
  const { value, loading } = useMnemonic();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener.remove();
  }, []);
  return (
    <Screen name="RecoveryPhraseConfirmScreen" deferContent={false}>
      {focused &&
        active &&
        (loading ? (
          <Text loading placeholder="Loading recovery phrase" />
        ) : value ? (
          <LoadedQuiz mnemonic={value} />
        ) : (
          <Text>Could not load your recovery phrase. Go back and try again.</Text>
        ))}
      <Button
        testID="recovery-confirm-cancel"
        variant="secondary"
        text="Cancel"
        onPress={() => router.back()}
      />
    </Screen>
  );
}
