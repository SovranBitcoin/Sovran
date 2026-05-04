import React, { useState } from 'react';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import NumericKeyboard from './NumericKeyboard';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { BlurView } from 'expo-blur';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import AnimatedSpriteBackground from '@/shared/ui/composed/SpriteView';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, Log } from '@/shared/lib/logger';

interface Props {
  passcode: string;
  onSuccess: () => void;
}

const AVATAR_SIZE = 80;
const SPACING = 16;

const TEXT_SHADOW = {
  textShadowColor: 'black',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 3,
} as const;

const DOT_SHADOW = {
  shadowColor: 'black',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 1,
  shadowRadius: 3,
} as const;

const AVATAR_SHADOW = {
  shadowColor: 'red',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 1,
  shadowRadius: 3,
} as const;

const PasscodeScreen: React.FC<Props> = ({ passcode, onSuccess }) => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const profileDisplay = useProfileDisplay(nostrKeys?.pubkey || '');
  const [value, setValue] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const opacity = useSharedValue(1);
  const shake = useSharedValue(0);
  const background = useThemeColor('background');

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: shake.value }],
  }));

  const getDotStyle = (isActive: boolean) => ({
    backgroundColor: isActive ? 'rgb(255 255 255)' : 'transparent',
    borderColor: isActive ? 'transparent' : 'rgb(255 255 255)',
    ...DOT_SHADOW,
  });

  const handlePress = (val: string) => {
    if (val.length > passcode.length) return;
    setValue(val);
    if (val.length === passcode.length) {
      if (val === passcode) {
        log.info('auth.passcode.verify_success');
        opacity.value = withTiming(0, { duration: 300 }, (finished) => {
          'worklet';
          if (finished) runOnJS(onSuccess)();
        });
      } else {
        log.warn('auth.passcode.verify_failed');
        shake.value = withSequence(
          withTiming(-10, { duration: 50 }),
          withTiming(10, { duration: 50 }),
          withTiming(-10, { duration: 50 }),
          withTiming(0, { duration: 50 })
        );
        setTimeout(() => {
          setValue('');
          setKeyIdx((k) => k + 1);
        }, 200);
      }
    }
  };

  return (
    <Log name="PasscodeScreen">
      <BlurView className="bg-background flex-1">
        <Animated.View className="bg-background flex-1" style={containerStyle}>
          <VStack align="center" justify="center" flex={1} spacing={SPACING}>
            <AnimatedSpriteBackground backgroundColor={background} />

            <View style={AVATAR_SHADOW}>
              <Avatar
                state={profileDisplay.picture ? 'image' : 'fallback'}
                seed={nostrKeys?.pubkey}
                picture={profileDisplay.picture}
                name={profileDisplay.displayName}
                size={AVATAR_SIZE}
              />
            </View>

            <Text size={18} weight="bold" className="text-foreground" style={TEXT_SHADOW}>
              {`Welcome back, ${profileDisplay.displayName}`}
            </Text>

            <HStack>
              {Array.from({ length: passcode.length }).map((_, i) => (
                <View
                  key={i}
                  className={`mx-1.5 h-3 w-3 rounded-full ${value.length > i ? '' : 'border'}`}
                  style={getDotStyle(value.length > i)}
                />
              ))}
            </HStack>

            <NumericKeyboard key={keyIdx} onKeyPress={handlePress} />
          </VStack>
        </Animated.View>
      </BlurView>
    </Log>
  );
};

export default PasscodeScreen;
