import React from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TermsAndConditionsScreen } from '@/features/onboarding/screens/TermsAndConditionsScreen';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import OnboardingScreen from '@/features/onboarding/components/OnboardingScreen';

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
      <TermsAndConditionsScreen
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
