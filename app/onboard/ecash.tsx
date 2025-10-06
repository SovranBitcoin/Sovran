import React from 'react';
import { OnboardingLayout } from './OnboardLayout';
import { useTheme } from 'providers/ThemeProvider';

export default function ModalScreen() {
  const { getGreenColor } = useTheme();

  return (
    <OnboardingLayout
      title="BITCOIN THAT"
      highlight="FEELS LIKE CASH"
      description="Send and receive instantly, with zero fees and full privacy—anytime, anywhere."
      highlightColors={[getGreenColor('300'), getGreenColor('200')]}
      nextScreen="onboard/nostr"
    />
  );
}
