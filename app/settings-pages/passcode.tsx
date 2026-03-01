import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { router } from 'expo-router';
import { useSettingsStore } from 'stores/settingsStore';
import NumericKeyboard from 'components/blocks/passcode/NumericKeyboard';
import Container from 'components/blocks/Container';
import { Card } from 'components/ui/Card';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { popup } from '@/helper/popup';

const PASSCODE_LENGTH = 4;

const PasscodeSettings: React.FC = () => {
  const setPasscode = useSettingsStore((state) => state.setPasscode);
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keyIdx, setKeyIdx] = useState(0);

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
      <ScrollView className={'px-4'}>
        <Card
          message="Forgetting your passcode will prevent you from accessing your wallet."
          variant="warning"
        />
        <VStack justify="space-between" align="center" className="flex-1 py-8">
          <VStack align="center" justify="center" className="flex-1">
            <Text size={20} weight="bold" className="text-foreground mb-5 text-center">
              {step === 'create' ? 'Enter new passcode' : 'Confirm passcode'}
            </Text>
            <HStack className="mb-5">
              {Array.from({ length: PASSCODE_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  className={`mx-1.5 h-3 w-3 rounded-full ${
                    currentValue.length > i ? 'bg-foreground' : 'border-foreground border'
                  }`}
                />
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

export default PasscodeSettings;
