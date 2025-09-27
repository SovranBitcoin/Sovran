import React, { useState, useRef } from 'react';
import { Animated } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import NumericKeyboard from './NumericKeyboard';
import { Avatar } from '../common/Avatar';
import { useNostr } from 'helper/redux/nostr';
import { BlurView } from 'expo-blur';
import { View, HStack, VStack } from 'components/common/View';
import { Text } from 'components/common/Text';
import AnimatedSpriteBackground from 'components/common/SpriteView';

interface Props {
  passcode: string;
  onSuccess: () => void;
}

const AVATAR_SIZE = 80;
const SPACING = 16;

const PasscodeScreen: React.FC<Props> = ({ passcode, onSuccess }) => {
  const theme = useSelector(memoizedGetTheme);
  const { currentProfile } = useNostr();
  const [value, setValue] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;

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
    backgroundColor: isActive ? greys(theme)[0] : 'transparent',
    borderColor: isActive ? 'transparent' : greys(theme)[0],
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
    <BlurView className="flex-1" style={{ backgroundColor: greys(theme)[950] }}>
      <Animated.View
        className="flex-1"
        style={{
          backgroundColor: greys(theme)[950],
          opacity,
          transform: [{ translateX: shake }],
        }}>
        <VStack align="center" justify="center" flex={1} spacing={SPACING}>
          <AnimatedSpriteBackground backgroundColor={greys(theme)[950]} />

          {currentProfile?.picture && (
            <View style={avatarShadow}>
              <Avatar picture={currentProfile.picture} size={AVATAR_SIZE} />
            </View>
          )}

          {currentProfile?.profile?.name ? (
            <Text
              size={18}
              weight="bold"
              style={{
                color: greys(theme)[0],
                ...textShadow,
              }}>
              {`Welcome back, ${currentProfile?.profile?.name}`}
            </Text>
          ) : (
            <Text
              size={20}
              weight="bold"
              style={{
                color: greys(theme)[0],
                ...textShadow,
                textShadowRadius: 10,
              }}>
              Enter Passcode
            </Text>
          )}

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
