import React from 'react';
import { purples } from 'helper/colors';
import { OnboardingLayout } from './OnboardLayout';

export default function ModalScreen() {
  return (
    <OnboardingLayout
      title="POWERED BY"
      highlight="NOSTR"
      description="SOVRAN runs on Nostr, a resilient network that can’t be shut down or censored."
      highlightColors={[purples[200], purples[300]]}
      nextScreen="onboard/new"
    />
  );
}
