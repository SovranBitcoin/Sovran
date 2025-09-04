import React, { useEffect, useState } from 'react';
import { purples } from 'helper/colors';
import { OnboardingLayout } from './OnboardLayout';
import { hasMnemonic } from 'helper/secureStorage';

export default function ModalScreen() {
  const [hasMnemonic_, setHasMnemonic_] = useState(false);

  useEffect(() => {
    hasMnemonic().then((hasMnemonic) => {
      setHasMnemonic_(hasMnemonic);
    });
  }, []);

  return (
    <OnboardingLayout
      title="POWERED BY"
      highlight="NOSTR"
      description="SOVRAN runs on Nostr, a resilient network that can’t be shut down or censored."
      highlightColors={[purples[100], purples[300]]}
      nextScreen={hasMnemonic_ ? 'onboard/restoreChoice' : 'onboard/new'}
    />
  );
}
