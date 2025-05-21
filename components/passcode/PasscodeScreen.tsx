import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import NumericKeyboard from './NumericKeyboard';

interface Props {
  passcode: string;
  onSuccess: () => void;
}

const PasscodeScreen: React.FC<Props> = ({ passcode, onSuccess }) => {
  const theme = useSelector(memoizedGetTheme);
  const [value, setValue] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const styles = createStyles(theme);

  const handlePress = (val: string) => {
    if (val.length > passcode.length) return;
    setValue(val);
    if (val.length === passcode.length) {
      if (val === passcode) {
        onSuccess();
      } else {
        setTimeout(() => {
          setValue('');
          setKeyIdx((k) => k + 1);
        }, 200);
      }
    }
  };

  return (
    <View style={styles.container}>
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
    </View>
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
