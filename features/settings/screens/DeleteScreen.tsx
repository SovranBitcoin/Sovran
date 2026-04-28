import React, { useCallback } from 'react';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  Extrapolation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { deleteAllProfiles } from '@/shared/lib/profile/profileSessionOrchestrator';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import Icon from 'assets/icons';
import { Button, Card } from 'heroui-native';
import opacity from 'hex-color-opacity';

const SLIDER_WIDTH = Dimensions.get('window').width - 48;
const THUMB_SIZE = 40;
const TRACK_PADDING = 4;
const MAX_TRANSLATE = SLIDER_WIDTH - THUMB_SIZE - TRACK_PADDING * 2;

interface SlideToDeleteProps {
  onComplete: () => void;
  trackColor: string;
  thumbColor: string;
  textColor: string;
  iconColor: string;
}

const SlideToDelete: React.FC<SlideToDeleteProps> = ({
  onComplete,
  trackColor,
  thumbColor,
  textColor,
  iconColor,
}) => {
  const translateX = useSharedValue(0);
  const isComplete = useSharedValue(false);

  const handleComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (isComplete.value) return;
      translateX.value = Math.max(0, Math.min(event.translationX, MAX_TRANSLATE));
    })
    .onEnd(() => {
      if (isComplete.value) return;

      if (translateX.value > MAX_TRANSLATE * 0.9) {
        translateX.value = withSpring(MAX_TRANSLATE, { damping: 20, stiffness: 200 });
        isComplete.value = true;
        runOnJS(handleComplete)();
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const textAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, MAX_TRANSLATE * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureHandlerRootView>
      <View
        style={[
          styles.track,
          {
            backgroundColor: trackColor,
            width: SLIDER_WIDTH,
          },
        ]}>
        <Animated.View style={[styles.textContainer, textAnimatedStyle]}>
          <Text size={16} medium style={{ color: textColor }}>
            Swipe to delete →
          </Text>
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.thumb,
              thumbAnimatedStyle,
              {
                backgroundColor: thumbColor,
              },
            ]}>
            <Icon name="mdi:trash-can-outline" size={24} color={iconColor} />
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  track: {
    height: THUMB_SIZE + TRACK_PADDING * 2,
    borderRadius: (THUMB_SIZE + TRACK_PADDING * 2) / 2,
    justifyContent: 'center',
    padding: TRACK_PADDING,
  },
  textContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function DeleteScreen() {
  useLifecycleLogger('DeleteScreen');
  const foreground = useThemeColor('foreground');
  const [danger, red400] = useThemeColor(['danger', 'red-400'] as const);

  const handleDelete = useCallback(async () => {
    log.warn('settings.delete.confirmed', { reason: 'user_initiated_slide_to_delete' });
    await deleteAllProfiles();
    log.info('settings.delete.complete');
  }, []);

  return (
    <ScreenWrapper name="DeleteScreen" scroll="custom" safeArea>
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
          <VStack spacing={24} className="flex-1 px-6 pt-12">
            <VStack spacing={24} className="flex-1 items-center justify-center">
              <View
                className="h-24 w-24 items-center justify-center self-center rounded-full"
                style={{ backgroundColor: danger }}>
                <Icon name="mdi:trash-can-outline" size={48} color={red400} />
              </View>

              <VStack spacing={8} className="items-center">
                <Text size={24} bold className="text-foreground text-center">
                  Delete Account
                </Text>
                <Text
                  size={16}
                  className="text-center leading-6"
                  style={{ color: opacity(foreground, 0.5) }}>
                  This will permanently erase all wallet data, all profiles, and all keys from this
                  device. The app will restart as if freshly installed. This action cannot be
                  reversed.
                </Text>
              </VStack>

              <Card variant="secondary" className="w-full">
                <Card.Body className="gap-2">
                  <Card.Title>Save your NIP06</Card.Title>
                  <Card.Description>
                    Your NIP06 is the recovery phrase for your full Sovran account. Every Cashu
                    profile in this app is derived from it, so restoring with a different NIP06 will
                    create different Cashu wallets and will not recover the same ecash. If you were a
                    TestFlight user, recovery may still not restore all historical funds.
                  </Card.Description>
                </Card.Body>
              </Card>

              <Card variant="secondary" className="w-full">
                <Card.Body className="gap-2">
                  <Card.Title>Imported Nostr accounts</Card.Title>
                  <Card.Description>
                    Even imported Nostr accounts depend on your current NIP06 for their Cashu profile.
                    Re-importing the same Nostr key under a different NIP06 will produce a different
                    Cashu profile, so that ecash will not be recoverable.
                  </Card.Description>
                </Card.Body>
              </Card>

              <Card variant="secondary" className="w-full">
                <Card.Body className="gap-2">
                  <Card.Title>Before deleting, make sure you have:</Card.Title>
                  <Card.Description>
                    - Backed up your NIP06{'\n'}- Transferred any ecash you do not want to risk
                    {'\n'}- Exported any important data
                  </Card.Description>
                </Card.Body>
              </Card>
            </VStack>

            <VStack spacing={12} className="w-full items-center pb-6">
              <SlideToDelete
                onComplete={handleDelete}
                trackColor={danger}
                thumbColor={foreground}
                textColor={foreground}
                iconColor={danger}
              />
              <Button variant="secondary" className="w-full" onPress={() => router.back()}>
                <Button.Label>Cancel</Button.Label>
              </Button>
            </VStack>
          </VStack>
        </ScrollView>
    </ScreenWrapper>
  );
}
