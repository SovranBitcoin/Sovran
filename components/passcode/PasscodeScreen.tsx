import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import NumericKeyboard from './NumericKeyboard';
import CachedImage from '../common/Image';
import { useNostr } from 'helper/redux/nostr';

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

  const name = currentProfile?.displayName || currentProfile?.name;

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateX: shake }] }]}>
      {currentProfile?.picture && (
        <CachedImage
          style={styles.avatar}
          source={{ uri: currentProfile.picture }}
        />
      )}
      {name && <Text style={styles.welcome}>{`Welcome back, ${name}`}</Text>}
      <Text style={styles.title}>Enter Passcode</Text>
      <View style={styles.dotsContainer}>
        {Array.from({ length: passcode.length }).map((_, i) => (
          <View
            key={i}
            style={value.length > i ? styles.dotActive : styles.dot}
          />
        ))}
      </View>
      <NumericKeyboard key={keyIdx} onKeyPress={handlePress} />
    </Animated.View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: greys(theme)[2300],
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      marginBottom: 16,
    },
    welcome: {
      color: greys(theme)[0],
      fontSize: 18,
      marginBottom: 16,
      fontFamily: 'OverpassBold',
    },
    title: {
      color: greys(theme)[0],
      fontSize: 20,
      marginBottom: 20,
      fontFamily: 'OverpassBold',
    },
    dotsContainer: {
      flexDirection: 'row',
      marginBottom: 20,
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: greys(theme)[0],
      marginHorizontal: 6,
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
