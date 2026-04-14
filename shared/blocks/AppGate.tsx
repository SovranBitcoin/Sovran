import React, { useEffect, useState } from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TermsAndConditionsScreen } from '@/features/onboarding/screens/TermsAndConditionsScreen';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import OnboardingScreen from '@/features/onboarding/components/OnboardingScreen';
import { log, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { retrieveCashuSeed } from '@/shared/lib/nostr/secureStorage';

type ReinstallState = 'checking' | 'none' | 'detected';

/**
 * Detects whether the user is a returning user whose app was reinstalled.
 * SecureStore persists across reinstalls on iOS, but AsyncStorage (settings) is wiped.
 * If a seed exists in SecureStore but onboarding hasn't been seen → reinstall.
 *
 * Backward-compatible: existing users upgrading will have hasSeenOnboarding=true
 * from their persisted settingsStore, so they'll never trigger this path.
 */
function useReinstallDetection(hasSeenOnboarding: boolean): ReinstallState {
  const [state, setState] = useState<ReinstallState>('checking');

  useEffect(() => {
    // Only check for returning users during onboarding phase
    if (hasSeenOnboarding) {
      setState('none');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const cached = await retrieveCashuSeed(0);
        if (cancelled) return;
        if (cached?.seed) {
          log.info('gate.reinstall.detected', { seedExists: true });
          setState('detected');
        } else {
          setState('none');
        }
      } catch {
        if (!cancelled) setState('none');
      }
    })();
    return () => { cancelled = true; };
  }, [hasSeenOnboarding]);

  return state;
}

interface AppGateProps {
  children: React.ReactNode;
}

/**
 * AppGate gates the app behind terms acceptance, onboarding, and key readiness.
 * Order: Terms → Reinstall detection → Onboarding carousel → Keys loading → App
 *
 * If a reinstall is detected (seed in SecureStore but no settings), the user
 * is shown a recovery prompt instead of the normal onboarding flow.
 */
const AppGate: React.FC<AppGateProps> = ({ children }) => {
  useLifecycleLogger('AppGate');
  const { isReady, isLoading } = useNostrKeysContext();
  const isTermsAccepted = useSettingsStore((state) => state.isTermsAccepted());
  const acceptTerms = useSettingsStore((state) => state.acceptTerms);
  const hasSeenOnboarding = useSettingsStore((state) => state.hasSeenOnboarding);
  const completeOnboarding = useSettingsStore((state) => state.completeOnboarding);
  const reinstallState = useReinstallDetection(hasSeenOnboarding);

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

  // Wait for reinstall detection before showing onboarding
  if (reinstallState === 'checking') {
    log.debug('gate.app.blocked', { reason: 'checking_reinstall' });
    return null;
  }

  if (!hasSeenOnboarding) {
    if (reinstallState === 'detected') {
      // Returning user — skip onboarding and go straight to app.
      // The app will detect the existing seed and should prompt recovery.
      log.info('gate.app.reinstall_skip_onboarding');
      completeOnboarding();
      // Fall through to key loading below
    } else {
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
  }

  if (isLoading || !isReady) {
    log.debug('gate.app.blocked', { reason: 'keys_not_ready', isLoading, isReady });
    return null;
  }

  log.debug('gate.app.ready');
  return <Log name="AppGate">{children}</Log>;
};

export default AppGate;
