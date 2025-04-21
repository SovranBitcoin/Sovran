import React from 'react';
import { shades } from 'helper/colors';
import { OnboardingLayout } from './OnboardLayout';
import { useTypedNavigation } from 'helper/navigation';

export default function ModalScreen() {
  const navigation = useTypedNavigation();

  return (
    <OnboardingLayout
      title="READY TO"
      highlight="GO?"
      description="You're all set. Start sending and receiving bitcoin instantly. Stay private, stay sovereign."
      highlightColors={[shades[300], shades[400]]}
      nextScreen="onboard/displayMnemonic"
      actions={[
        {
          text: 'Recover Wallet',
          onPress: () =>
            navigation.navigate('onboard/mnemonic', {
              type: 'recover',
              mnemonic: null,
            }),
        },
        {
          text: 'New Wallet',
          onPress: () => navigation.navigate('onboard/displayMnemonic'),
          variant: 'primary',
        },
      ]}
    />
  );
}
