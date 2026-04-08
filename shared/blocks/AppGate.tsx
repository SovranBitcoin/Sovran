import React from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TermsAndConditionsScreen } from '@/features/onboarding/screens/TermsAndConditionsScreen';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import OnboardingScreen from '@/features/onboarding/components/OnboardingScreen';
import { log, Log, useLifecycleLogger } from '@/shared/lib/logger';

interface AppGateProps {
  children: React.ReactNode;
}

/**
 * AppGate gates the app behind terms acceptance, onboarding, and key readiness.
 * Order: Terms → Onboarding carousel → Keys loading → App
 */
const AppGate: React.FC<AppGateProps> = ({ children }) => {
  useLifecycleLogger('AppGate');
  const { isReady, isLoading } = useNostrKeysContext();
  const isTermsAccepted = useSettingsStore((state) => state.isTermsAccepted());
  const acceptTerms = useSettingsStore((state) => state.acceptTerms);
  const hasSeenOnboarding = useSettingsStore((state) => state.hasSeenOnboarding);
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding);

  if (!isTermsAccepted) {
    log.debug('gate.app.blocked', { reason: 'terms_not_accepted' });
    return (
      <Log name="AppGate">
        <TermsAndConditionsScreen
          onClose={() => {
            log.info('gate.app.terms_accepted');
            acceptTerms(new Date().toISOString());
          }}
        />
      </Log>
    );
  }

  if (!hasSeenOnboarding) {
    log.debug('gate.app.blocked', { reason: 'onboarding_not_seen' });
    return (
      <Log name="AppGate">
        <OnboardingScreen
          onComplete={() => {
            log.info('gate.app.onboarding_complete');
            completeOnboarding();
          }}
        />
      </Log>
    );
  }

  if (isLoading || !isReady) {
    log.debug('gate.app.blocked', { reason: 'keys_not_ready', isLoading, isReady });
    return null;
  }

  log.debug('gate.app.ready');
  return <Log name="AppGate">{children}</Log>;
};

export default AppGate;
