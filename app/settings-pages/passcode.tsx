import React, { useState } from 'react';
import { Text, StyleSheet, ScrollView } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { router } from 'expo-router';
import { useSettings } from 'redux/settings';
import { useTheme } from 'providers/ThemeProvider';
import NumericKeyboard from 'components/blocks/passcode/NumericKeyboard';
import Container from 'components/blocks/Container';
import { Card } from 'components/ui/Card';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { popup } from '@/helper/popup';

const PASSCODE_LENGTH = 4;

const PasscodeSettings: React.FC = () => {
  const { getPrimaryColor } = useTheme();
  const { setPasscode } = useSettings();
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);
  const styles = createStyles(getPrimaryColor);

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
        <VStack justify="space-between" align="center" style={styles.container}>
          <VStack align="center" justify="center" style={styles.content}>
            <Text style={styles.title} className="text-primary-0">
              {step === 'create' ? 'Enter new passcode' : 'Confirm passcode'}
            </Text>
            <HStack style={styles.dotsContainer}>
              {Array.from({ length: PASSCODE_LENGTH }).map((_, i) => (
                <View key={i} style={currentValue.length > i ? styles.dotActive : styles.dot} />
              ))}
            </HStack>
          </VStack>
          <NumericKeyboard key={keyIdx} onKeyPress={handlePress} />
        </VStack>
        <ButtonHandler
          buttons={[
            {
              text: 'Reset',
              icon: 'reset',
              variant: 'secondary',
              onPress: async () => {
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
              onPress: async () => {
                if (code === confirm && code.length === PASSCODE_LENGTH) {
                  setPasscode(code);
                  router.back();
                } else {
                  popup({ message: 'passcode_not_match', emoji: '🚨', type: 'error' });
                }
              },
            },
          ]}
        />
      </ScrollView>
    </Container>
  );
};

const createStyles = (getPrimaryColor: (shade: string) => string) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingVertical: 32,
    },
    content: {
      flex: 1,
    },
    title: {
      fontSize: 20,
      marginBottom: 20,
      fontFamily: 'OverpassBold',
      textAlign: 'center',
    },
    dotsContainer: {
      marginBottom: 20,
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: getPrimaryColor('0'),
      marginHorizontal: 6,
    },
    dotActive: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: getPrimaryColor('0'),
      marginHorizontal: 6,
    },
  });

export default PasscodeSettings;
