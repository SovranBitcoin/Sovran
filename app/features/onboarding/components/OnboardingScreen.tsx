import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  useReducedMotion,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { onboardingCopy } from 'copy/onboarding';

import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import { openMnemonicRecovery } from '@/shared/lib/profile/keyRecovery';
import { log } from '@/shared/lib/logger';
import { duration } from '@/shared/styles/tokens';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen } from '@/shared/ui/composed/Screen';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

import { OnboardingIllustration } from './OnboardingIllustration';

const CARDS = [
  { ...onboardingCopy.slides.cashu, illustration: 'cashu' },
  { ...onboardingCopy.slides.nostr, illustration: 'nostr' },
  { ...onboardingCopy.slides.privacy, illustration: 'privacy' },
  { ...onboardingCopy.slides.start, illustration: 'start' },
] as const;

const LAST = CARDS.length - 1;

type EntryAnimation = ReturnType<typeof FadeInRight.duration>;
/** A horizontal drag this far, mostly sideways, turns the card. */
const SWIPE_PX = 48;

type OnboardingScreenProps = {
  onComplete: () => void;
  /**
   * Replaces the recovery-phrase form. Set where the running app is already
   * underneath (the design system), so no second menu host is mounted either.
   */
  onRecoveryPhrase?: () => void;
};

/**
 * The introduction: one card at a time, moved on only by the person. Next
 * becomes Get Started on the last card; a sideways swipe and Android back
 * turn the cards too. Nothing advances by itself and no control is hidden.
 */
export default function OnboardingScreen({ onComplete, onRecoveryPhrase }: OnboardingScreenProps) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const turn = (to: number) => {
    if (to < 0 || to > LAST) return;
    setDirection(to > index ? 'forward' : 'back');
    setIndex(to);
    log.info('onboarding.slide.change', { slideIndex: to });
  };

  useEffect(() => {
    if (index === 0) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setDirection('back');
      setIndex(index - 1);
      return true;
    });
    return () => subscription.remove();
  }, [index]);

  const swipe = Gesture.Pan()
    .activeOffsetX([-SWIPE_PX / 2, SWIPE_PX / 2])
    .failOffsetY([-SWIPE_PX / 2, SWIPE_PX / 2])
    .onEnd((event) => {
      if (event.translationX <= -SWIPE_PX) scheduleOnRN(turn, index + 1);
      else if (event.translationX >= SWIPE_PX) scheduleOnRN(turn, index - 1);
    });

  const finish = () => {
    log.info('onboarding.completed', { slidesSeen: index + 1 });
    onComplete();
  };

  const entering: EntryAnimation = (
    reducedMotion ? FadeIn : direction === 'forward' ? FadeInRight : FadeInLeft
  ).duration(duration.standard);

  return (
    <>
      <Screen
        name="OnboardingScreen"
        scroll="custom"
        safeArea
        deferContent={false}
        footer={
          <BottomButtons>
            {index < LAST ? (
              <Button
                testID="onboarding-next"
                text={onboardingCopy.next}
                onPress={() => turn(index + 1)}
              />
            ) : (
              <Button
                testID="onboarding-get-started"
                text={onboardingCopy.getStarted}
                onPress={finish}
              />
            )}
            <Button
              testID="onboarding-recovery-phrase"
              text={onboardingCopy.recoveryPhrase}
              variant="underline"
              onPress={onRecoveryPhrase ?? openMnemonicRecovery}
            />
          </BottomButtons>
        }>
        <GestureDetector gesture={swipe}>
          <View className="flex-1" collapsable={false}>
            <View className="h-12 items-start px-8">
              {index > 0 && (
                <Button
                  testID="onboarding-back"
                  text={onboardingCopy.back}
                  variant="underline"
                  onPress={() => turn(index - 1)}
                />
              )}
            </View>
            <CardStage index={index} entering={entering} />
          </View>
        </GestureDetector>
      </Screen>
      {!onRecoveryPhrase && <ActionMenuHost />}
    </>
  );
}

/**
 * Card content can grow and scroll with text size. The footer stays outside
 * the card gesture area, so its actions remain directly reachable.
 */
function CardStage({ index, entering }: { index: number; entering: EntryAnimation }) {
  const card = CARDS[index]!;
  return (
    <ScreenScrollView className="flex-1" contentContainerClassName="grow justify-center px-8">
      <Animated.View key={index} entering={entering} className="gap-8 py-6">
        <View className="min-h-60 items-center justify-center">
          <OnboardingIllustration kind={card.illustration} />
        </View>
        <View className="gap-3">
          <Text size={28} bold className="text-center" accessibilityRole="header">
            {card.title}
          </Text>
          <Text size={16} className="text-foreground/70 text-center">
            {card.description}
          </Text>
        </View>
      </Animated.View>
      <HStack
        className="justify-center gap-2 pt-6"
        accessible
        testID="onboarding-position"
        accessibilityLabel={`Card ${index + 1} of ${CARDS.length}`}>
        {CARDS.map((each, dot) => (
          <View
            key={each.title}
            className={`h-2 rounded-full ${dot === index ? 'bg-foreground w-5' : 'bg-foreground/25 w-2'}`}
          />
        ))}
      </HStack>
    </ScreenScrollView>
  );
}
