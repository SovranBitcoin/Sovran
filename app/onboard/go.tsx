import React from 'react';
import { shades } from 'helper/colors';
import { OnboardingLayout } from './OnboardLayout';
import { router } from 'expo-router';

export default function ModalScreen() {
  return (
    <OnboardingLayout
      title="READY TO"
      highlight="GO?"
      description="You're all set. Start sending and receiving bitcoin instantly. Stay private, stay sovereign."
      highlightColors={[shades[300], shades[200]]}
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
