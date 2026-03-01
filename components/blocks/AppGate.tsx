import React from 'react';

import { useSettingsStore } from 'stores/settingsStore';
import TermsConditionsScreen from 'app/settings-pages/terms';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import OnboardingScreen from 'components/blocks/onboarding/OnboardingScreen';

interface AppGateProps {
  children: React.ReactNode;
}

/**
 * AppGate gates the app behind terms acceptance, onboarding, and key readiness.
 * Order: Terms → Onboarding carousel → Keys loading → App
 */
const AppGate: React.FC<AppGateProps> = ({ children }) => {
  const { isReady, isLoading } = useNostrKeysContext();
  const isTermsAccepted = useSettingsStore((state) => state.isTermsAccepted());
  const acceptTerms = useSettingsStore((state) => state.acceptTerms);
  const hasSeenOnboarding = useSettingsStore((state) => state.hasSeenOnboarding);
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding);

  if (!isTermsAccepted) {
    return (
      <TermsConditionsScreen
        onClose={() => {
          acceptTerms(new Date().toISOString());
        }}
      />
    );
  }

  if (!hasSeenOnboarding) {
    return <OnboardingScreen onComplete={completeOnboarding} />;
  }

  if (isLoading || !isReady) {
    return null;
  }

  return <>{children}</>;
};

export default AppGate;
