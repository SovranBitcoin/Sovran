import React, { useState, useRef } from 'react';
import { Animated } from 'react-native';
import NumericKeyboard from './NumericKeyboard';
import { Avatar } from 'components/ui/Avatar';
import { BlurView } from 'expo-blur';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import AnimatedSpriteBackground from 'components/ui/SpriteView';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { getUsername } from '@/helper/username';

interface Props {
  passcode: string;
  onSuccess: () => void;
}

const AVATAR_SIZE = 80;
const SPACING = 16;

const PasscodeScreen: React.FC<Props> = ({ passcode, onSuccess }) => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const [value, setValue] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const { getPrimaryColor } = useTheme();

  // Shadow styles - cannot be fully replicated with Tailwind in React Native
  const textShadow = {
    textShadowColor: 'black',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  };

  const dotShadow = {
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3,
  };

  const avatarShadow = {
    shadowColor: 'red',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3,
  };

  // Helper function for dot styling
  const getDotStyle = (isActive: boolean) => ({
    backgroundColor: isActive ? 'rgb(255 255 255)' : 'transparent',
    borderColor: isActive ? 'transparent' : 'rgb(255 255 255)',
    ...dotShadow,
  });

  const handlePress = (val: string) => {
    if (val.length > passcode.length) return;
    setValue(val);
    if (val.length === passcode.length) {
      if (val === passcode) {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => onSuccess());
      } else {
        Animated.sequence([
          Animated.timing(shake, {
            toValue: -10,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shake, {
            toValue: 10,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shake, {
            toValue: -10,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shake, {
            toValue: 0,
            duration: 50,
            useNativeDriver: true,
          }),
        ]).start();
        setTimeout(() => {
          setValue('');
          setKeyIdx((k) => k + 1);
        }, 200);
      }
    }
  };

  return (
    <BlurView className="flex-1 bg-primary-950">
      <Animated.View
        className="flex-1 bg-primary-950"
        style={{
          opacity,
          transform: [{ translateX: shake }],
        }}>
        <VStack align="center" justify="center" flex={1} spacing={SPACING}>
          <AnimatedSpriteBackground backgroundColor={getPrimaryColor('950')} />

          <View style={avatarShadow}>
            <Avatar seed={nostrKeys?.pubkey} size={AVATAR_SIZE} />
          </View>

          <Text
            size={18}
            weight="bold"
            className="text-primary-0"
            style={{
              ...textShadow,
            }}>
            {`Welcome back, ${getUsername(nostrKeys?.pubkey || '')}`}
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
  );
};

export default PasscodeScreen;
