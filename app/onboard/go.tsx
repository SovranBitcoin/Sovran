import React from 'react';
import { OnboardingLayout } from './OnboardLayout';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';

export default function ModalScreen() {
  const { getShadeColor } = useTheme();

  return (
    <OnboardingLayout
      title="READY TO"
      highlight="GO?"
      description="You're all set. Start sending and receiving bitcoin instantly. Stay private, stay sovereign."
      highlightColors={[getShadeColor('300'), getShadeColor('200')]}
      nextScreen="onboard/displayMnemonic"
      actions={[
        {
          variant: 'primary',
          text: 'Recover Wallet',
          onPress: () =>
            router.push({
              pathname: '/onboard/mnemonic',
              params: {
                type: 'recover',
                mnemonic: '',
              },
            }),
        },
        {
          text: 'New Wallet',
          onPress: () => router.push('/onboard/displayMnemonic'),
          variant: 'primary',
        },
      ]}
    />
  );
}
