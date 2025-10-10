import React from 'react';
import { OnboardingLayout } from './OnboardLayout';
import { useTheme } from 'providers/ThemeProvider';

export default function ModalScreen() {
  const { getPurpleColor } = useTheme();

  return (
    <OnboardingLayout
      title="POWERED BY"
      highlight="NOSTR"
      description="SOVRAN runs on Nostr, a resilient network that can't be shut down or censored."
      highlightColors={[getPurpleColor('100'), getPurpleColor('300')]}
      nextScreen={'onboard/new'}
    />
  );
}
