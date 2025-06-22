import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { useTypedNavigation } from 'helper/navigation';
import { memoizedGetTheme, useSettings } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import NumericKeyboard from 'components/passcode/NumericKeyboard';
import Container from 'components/layout/Container';
import { Card } from 'components/common/Card';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { showMessage } from 'helper/popup/popups';

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
      }
    }
  };

  const currentValue = step === 'create' ? code : confirm;

  return (
    <Container>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Card
          message="Forgetting your passcode will prevent you from accessing your wallet."
          variant="warning"></Card>
        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.title}>
              {step === 'create' ? 'Enter new passcode' : 'Confirm passcode'}
            </Text>
            <View style={styles.dotsContainer}>
              {Array.from({ length: PASSCODE_LENGTH }).map((_, i) => (
                <View key={i} style={currentValue.length > i ? styles.dotActive : styles.dot} />
              ))}
            </View>
          </View>
          <NumericKeyboard key={keyIdx} onKeyPress={handlePress} />
        </View>
        <ButtonHandler
          buttons={[
            {
              text: 'Reset',
              icon: 'reset',
              variant: 'secondary',
              onPress: () => {
                setPasscode('');
                setStep('create');
                setCode('');
                setConfirm('');
                setKeyIdx(0);
              },
            },
            {
              text: 'Confirm',
              icon: 'check',
              variant: 'primary',
              disabled: confirm.length !== PASSCODE_LENGTH,
              onPress: () => {
                if (code === confirm && code.length === PASSCODE_LENGTH) {
                  setPasscode(code);
                  navigation.goBack();
                } else {
                  showMessage('passcode_not_match', {}, { emoji: '🚨' });
                }
              },
            },
          ]}
        />
      </ScrollView>
    </Container>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 32,
    },
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      color: greys(theme)[0],
      fontSize: 20,
      marginBottom: 20,
      fontFamily: 'OverpassBold',
      textAlign: 'center',
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
