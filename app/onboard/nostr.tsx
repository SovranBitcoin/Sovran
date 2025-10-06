import React, { useEffect, useState } from 'react';
import { OnboardingLayout } from './OnboardLayout';
import { hasMnemonic } from 'helper/secureStorage';
import { useTheme } from 'providers/ThemeProvider';

export default function ModalScreen() {
  const [hasMnemonic_, setHasMnemonic_] = useState(false);
  const { getPurpleColor } = useTheme();

  useEffect(() => {
    hasMnemonic().then((hasMnemonic) => {
      setHasMnemonic_(hasMnemonic);
    });
  }, []);

  return (
    <OnboardingLayout
      title="POWERED BY"
      highlight="NOSTR"
      description="SOVRAN runs on Nostr, a resilient network that can't be shut down or censored."
      highlightColors={[getPurpleColor('100'), getPurpleColor('300')]}
      nextScreen={hasMnemonic_ ? 'onboard/restoreChoice' : 'onboard/new'}
    />
  );
}
