import React, { useState, useRef } from 'react';
import { StyleSheet, Animated } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import NumericKeyboard from './NumericKeyboard';
import CachedImage from '../common/Image';
import { useNostr } from 'helper/redux/nostr';
import { BlurView } from 'expo-blur';
import { View, HStack, VStack } from 'components/common/View';
import { Text } from 'components/common/Text';
import AnimatedSpriteBackground from 'components/common/SpriteView';

interface Props {
  passcode: string;
  onSuccess: () => void;
}

const PasscodeScreen: React.FC<Props> = ({ passcode, onSuccess }) => {
  const theme = useSelector(memoizedGetTheme);
  const { currentProfile } = useNostr();
  const [value, setValue] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const styles = createStyles(theme);

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
    <BlurView style={styles.container}>
      <Animated.View style={[styles.container, { opacity, transform: [{ translateX: shake }] }]}>
        <VStack align="center" justify="center" flex={1}>
          <AnimatedSpriteBackground backgroundColor={theme.greys[950]} />

          {currentProfile?.picture && (
            <CachedImage style={styles.avatar} source={{ uri: currentProfile.picture }} />
          )}

          {currentProfile?.profile?.name ? (
            <Text style={styles.welcome}>{`Welcome back, ${currentProfile?.profile?.name}`}</Text>
          ) : (
            <Text style={styles.title}>Enter Passcode</Text>
          )}

          <HStack style={styles.dotsContainer}>
            {Array.from({ length: passcode.length }).map((_, i) => (
              <View key={i} style={value.length > i ? styles.dotActive : styles.dot} />
            ))}
          </HStack>

          <NumericKeyboard key={keyIdx} onKeyPress={handlePress} />
        </VStack>
      </Animated.View>
    </BlurView>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: greys(theme)[950],
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      marginBottom: 16,

      shadowColor: 'red',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 1,
      shadowRadius: 3,
    },
    welcome: {
      color: greys(theme)[0],
      fontSize: 18,
      marginBottom: 16,
      fontFamily: 'OverpassBold',
      textShadowColor: 'black',
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 3,
    },
    title: {
      color: greys(theme)[0],
      fontSize: 20,
      marginBottom: 20,
      fontFamily: 'OverpassBold',
      textShadowColor: 'black',
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 10,
    },
    dotsContainer: {
      marginBottom: 20,
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: greys(theme)[0],
      marginHorizontal: 6,

      shadowColor: 'black',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 1,
      shadowRadius: 3,
    },
    dotActive: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: greys(theme)[0],
      marginHorizontal: 6,
    },
  });

export default PasscodeScreen;
