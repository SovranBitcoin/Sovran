import React from 'react';
import { greens } from 'helper/colors';
import { OnboardingLayout } from './OnboardLayout';

export default function ModalScreen() {
  return (
    <OnboardingLayout
      title="BITCOIN THAT"
      highlight="FEELS LIKE CASH"
      description="Send and receive instantly, with zero fees and full privacy—anytime, anywhere."
      highlightColors={[greens[300], greens[400]]}
      nextScreen="onboard/nostr"
    />
  );
}
