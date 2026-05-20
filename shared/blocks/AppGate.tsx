import React, { useEffect, useState } from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TermsAndConditionsScreen } from '@/features/onboarding/screens/TermsAndConditionsScreen';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import OnboardingScreen from '@/features/onboarding/components/OnboardingScreen';
import { log, Log, initLog, useInitMount, useLifecycleLogger } from '@/shared/lib/logger';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import {
  useWalletLifecycleStore,
  useWalletLifecycleHydrated,
} from '@/shared/stores/global/walletLifecycleStore';
import { SettingsRecoveryScreen } from '@/features/settings/screens/SettingsRecoveryScreen';

initLog('Module', 'AppGate loaded');

type ReinstallState = 'checking' | 'none' | 'detected';

/**
 * Detects whether the user is a returning user whose app was reinstalled.
 * SecureStore persists across reinstalls on iOS, but AsyncStorage (settings) is wiped.
 * If a seed exists in SecureStore but onboarding hasn't been seen → reinstall.
 *
 * Probes the master mnemonic at `user_mnemonic`, not the per-account
 * derived seed cache: SOV-00 §5 defines the reinstall signal as "seed in
 * enclave + onboarding not seen", and the enclave's authoritative seed
 * record is the master mnemonic. The derived `cashu_seed_0` cache is only
 * written after Coco runs against account 0 — so import-nsec-only prior
 * installs and fresh debug-mnemonic dev clients (SOV-00 §4.1 D5) miss it
 * and incorrectly land on the new-user carousel.
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
    void (async () => {
      try {
        const mnemonic = await retrieveMnemonic();
        if (cancelled) return;
        if (mnemonic != null) {
          log.info('gate.reinstall.detected', { seedExists: true });
          setState('detected');
        } else {
          setState('none');
        }
      } catch {
        if (!cancelled) setState('none');
      }
    })();
    return () => {
      cancelled = true;
    };
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
  useInitMount('AppGate');
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

  return (
    <Log name="AppGate">
      <RestoreGate>{children}</RestoreGate>
    </Log>
  );
};

/**
 * Once keys are ready, evaluates whether a NUT-13 wallet restore must run
 * before the app proceeds. Mnemonic exists in keychain but our lifecycle store
 * has no `seedCreatedAt` ⇒ this app installation didn't generate the seed
 * (reinstall, profile reset, iCloud restore, manual import). Block the app
 * behind /restore until that's resolved.
 */
const RestoreGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hydrated = useWalletLifecycleHydrated();
  const restoreStatus = useWalletLifecycleStore((s) => s.restoreStatus);
  const seedCreatedAt = useWalletLifecycleStore((s) => s.seedCreatedAt);
  const setRestoreStatus = useWalletLifecycleStore((s) => s.setRestoreStatus);
  const [evaluated, setEvaluated] = useState(false);

  useEffect(() => {
    // CRITICAL: wait for AsyncStorage hydration before reading lifecycle
    // state. Pre-hydration the store returns its in-memory initial values
    // (restoreStatus='unknown', seedCreatedAt=null) which would falsely
    // trigger a redirect for existing users on every boot.
    if (!hydrated) return;
    if (restoreStatus === 'complete' || restoreStatus === 'not-needed') {
      setEvaluated(true);
      return;
    }
    if (restoreStatus === 'pending' || restoreStatus === 'in-progress') {
      // Already decided in a previous boot — the screen will pick it up.
      setEvaluated(true);
      return;
    }
    // restoreStatus === 'unknown' or 'failed' → resolve now.
    let cancelled = false;
    void (async () => {
      try {
        const mnemonic = await retrieveMnemonic();
        if (cancelled) return;
        if (!mnemonic) {
          // No seed yet (brand new install). ensureMnemonicExists will mark
          // seedCreatedAt when it generates one — leave restoreStatus alone.
          setEvaluated(true);
          return;
        }
        if (seedCreatedAt == null) {
          log.info('gate.restore.needed', { reason: 'seed_pre_existed' });
          setRestoreStatus('pending');
        } else {
          log.debug('gate.restore.skip', { seedCreatedAt });
          setRestoreStatus('not-needed');
        }
      } finally {
        if (!cancelled) setEvaluated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restoreStatus, seedCreatedAt, setRestoreStatus]);

  if (!hydrated || !evaluated) {
    log.debug('gate.restore.evaluating', { hydrated, evaluated });
    return null;
  }

  if (
    restoreStatus === 'pending' ||
    restoreStatus === 'in-progress' ||
    restoreStatus === 'failed'
  ) {
    log.debug('gate.restore.blocked', { restoreStatus });
    return (
      <SettingsRecoveryScreen
        gateMode
        onComplete={() => {
          // Mark seedCreatedAt + restoreStatus complete so on next render
          // RestoreGate falls through to children. The Continue button only
          // appears in the `complete` state, which happens after recovery
          // succeeds — so this is the user's confirmation to proceed.
          useWalletLifecycleStore.getState().markSeedCreatedNow();
          useWalletLifecycleStore.getState().markRestoreComplete();
        }}
      />
    );
  }

  log.debug('gate.app.ready');
  return <>{children}</>;
};

export default AppGate;
