import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { useTypedNavigation } from 'helper/navigation';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import NumericKeyboard from 'components/passcode/NumericKeyboard';
import Container from 'components/layout/Container';

const PASSCODE_LENGTH = 4;

const PasscodeSettings: React.FC = () => {
  const theme = useSelector(memoizedGetTheme);
  const { setPasscode } = useSettings();
  const navigation = useTypedNavigation();
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const styles = createStyles(theme);

  const handlePress = (val: string) => {
    if (step === 'create') {
      if (val.length <= PASSCODE_LENGTH) {
        setCode(val);
        if (val.length === PASSCODE_LENGTH) {
          setStep('confirm');
          setKeyIdx((k) => k + 1);
        }
      }
    } else {
      if (val.length <= PASSCODE_LENGTH) {
        setConfirm(val);
        if (val.length === PASSCODE_LENGTH) {
          if (val === code) {
            setPasscode(val);
            navigation.goBack();
          } else {
            setStep('create');
            setCode('');
            setConfirm('');
            setKeyIdx((k) => k + 1);
          }
        }
      }
    }
  };

  const currentValue = step === 'create' ? code : confirm;

  return (
    <Container>
      <View style={styles.container}>
        <Text style={styles.title}>
          {step === 'create' ? 'Enter new passcode' : 'Confirm passcode'}
        </Text>
        <View style={styles.dotsContainer}>
          {Array.from({ length: PASSCODE_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={currentValue.length > i ? styles.dotActive : styles.dot}
            />
          ))}
        </View>
        <NumericKeyboard key={keyIdx} onKeyPress={handlePress} />
      </View>
    </Container>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
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

export default PasscodeSettings;
