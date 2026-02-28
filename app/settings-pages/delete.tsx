import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'components/ui/Text';
import Container from 'components/blocks/Container';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import { router } from 'expo-router';
import { useDispatch } from 'react-redux';
import type { AppThunk } from 'redux/store/reducer';
import { resetApp } from '@/redux/store';
import * as Updates from 'expo-updates';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';
import { Button, Card } from 'heroui-native';
import { useThemeColor } from '@/hooks/useThemeColor';

const SLIDER_WIDTH = Dimensions.get('window').width - 48; // Account for padding
const THUMB_SIZE = 56;
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

const DeleteScreen: React.FC = () => {
  const foreground = useThemeColor('foreground');
  const [danger, red400] = useThemeColor(['danger', 'red-400'] as const);
  const dispatch = useDispatch();

  const handleDeleteProfile = useCallback(async () => {
    await (dispatch as (thunk: AppThunk) => Promise<void>)(resetApp());
    await Updates.reloadAsync();
  }, [dispatch]);

  const handleCancel = useCallback(() => {
    router.back();
  }, []);

  return (
    <Container>
      <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
        <VStack spacing={24} className="flex-1 items-center justify-center px-6">
          <View
            style={{
              backgroundColor: danger,
              width: 96,
              height: 96,
              borderRadius: 48,
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
            }}>
            <Icon name="mdi:trash-can-outline" size={48} color={red400} />
          </View>

          <VStack spacing={8} className="items-center">
            <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
              Delete Account
            </Text>
            <Text
              size={16}
              style={{
                color: opacity(foreground, 0.5),
                textAlign: 'center',
                lineHeight: 24,
              }}>
              Are you sure you want to delete your profile? This action cannot be reversed.
            </Text>
          </VStack>

          <Card variant="secondary" className="w-full">
            <Card.Body className="gap-2">
              <Card.Title>Important</Card.Title>
              <Card.Description>
                There is no guarantee that your mnemonic phrase will recover your funds. If you were
                a TestFlight user, recovery may not restore all funds.
              </Card.Description>
            </Card.Body>
          </Card>

          <Card variant="secondary" className="w-full">
            <Card.Body className="gap-2">
              <Card.Title>Before deleting, make sure you have:</Card.Title>
              <Card.Description>
                - Backed up your mnemonic phrase{'\n'}- Transferred any remaining funds{'\n'}-
                Exported any important data
              </Card.Description>
            </Card.Body>
          </Card>

          <VStack spacing={12} className="w-full items-center">
            <SlideToDelete
              onComplete={handleDeleteProfile}
              trackColor={danger}
              thumbColor={foreground}
              textColor={foreground}
              iconColor={danger}
            />
            <Button variant="secondary" className="w-full" onPress={handleCancel}>
              <Button.Label>Cancel</Button.Label>
            </Button>
          </VStack>
        </VStack>
      </ScrollView>
    </Container>
  );
};

export default DeleteScreen;
