import React, { useState } from 'react';
import { useSettingsStore } from 'stores/settingsStore';
import TermsConditionsScreen from 'app/settings-pages/terms';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';

interface AppGateProps {
  children: React.ReactNode;
}

/**
 * AppGate component handles app-level checks like terms acceptance and onboarding
 * This prevents unnecessary hook execution in child components when these checks fail
 */
const AppGate: React.FC<AppGateProps> = ({ children }) => {
  const { keys, isReady, isLoading } = useNostrKeysContext();
  const isTermsAccepted = useSettingsStore((state) => state.isTermsAccepted());
  const acceptTerms = useSettingsStore((state) => state.acceptTerms);
  const [currentOnboardingStep, setCurrentOnboardingStep] = useState(0);

  // Check if terms have been accepted
  if (!isTermsAccepted) {
    return (
      <TermsConditionsScreen
        onClose={() => {
          acceptTerms(new Date().toISOString());
        }}
      />
    );
  }

  // Don't show onboarding while keys are still loading
  if (isLoading || !isReady) {
    return null; // The NostrKeysProvider will show its own loading screen
  }

  // If all checks pass, render the children
  return <>{children}</>;
};

export default AppGate;
