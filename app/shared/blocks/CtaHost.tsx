import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRootNavigationState } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import * as Application from 'expo-application';
import { useColadaBalance } from 'wallet/react';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useLatestVersionFetch } from '@/shared/hooks/useLatestVersionFetch';
import { selectNextCta } from '@/shared/lib/cta/selectNextCta';

export function CtaHost() {
  const navigation = useRootNavigationState();
  const latest = useSettingsStore((s) => s.lastKnownAppVersion);
  const mockMode = useSettingsStore((s) => s.mockMode);
  const seedCreatedAt = useWalletLifecycleStore((s) => s.seedCreatedAt);
  const recoveryPhraseVerifiedAt = useWalletLifecycleStore((s) => s.recoveryPhraseVerifiedAt);
  const recoveryPhraseVerifiedRevision = useWalletLifecycleStore(
    (s) => s.recoveryPhraseVerifiedRevision
  );
  const restoreStatus = useWalletLifecycleStore((s) => s.restoreStatus);
  const balance = useColadaBalance('sat');
  const dismissed = useCtaStore((s) => s.dismissed);
  const activeId = useCtaStore((s) => s.activeId);
  const backupStartedAt = useCtaStore((s) => s.backupStartedAt);
  const previewOverride = useCtaStore((s) => s.previewOverride);
  useLatestVersionFetch(activeId === 'update-required' && previewOverride === null);
  const [hydrated, setHydrated] = useState(useCtaStore.persist.hasHydrated);
  const [nowMs, setNowMs] = useState(Date.now);
  const observedRoute = useRef(false);
  const automation = __DEV__ && !!process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;

  useEffect(() => {
    const unsub = useCtaStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useCtaStore.persist.hasHydrated());
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => {
      unsub();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !navigation?.key || restoreStatus === 'pending' || restoreStatus === 'failed')
      return;
    const next =
      previewOverride ??
      selectNextCta({
        nowMs: Date.now(),
        nativeVersion: Application.nativeApplicationVersion ?? '',
        latest,
        lifecycle: {
          seedCreatedAt,
          recoveryPhraseVerifiedAt,
          recoveryPhraseVerifiedRevision,
          restoreStatus,
        },
        balanceTotalSat: balance.total,
        backupStartedAt,
        dismissed,
        mockMode,
        automation,
      })?.id;
    const ctaRoute = navigation.routes.some((route) => route.name === 'cta');
    if (ctaRoute) {
      observedRoute.current = true;
      if (activeId === 'update-required' && !previewOverride && next !== activeId) {
        // CtaScreen releases its removal guard before navigating back.
        useCtaStore.getState().closeActive();
      }
      return;
    }
    if (activeId || useCtaStore.getState().backupRequested) {
      if (!observedRoute.current) return; // push reserved, waiting for navigator
      observedRoute.current = false;
      const store = useCtaStore.getState();
      // CtaScreen owns explicit dismissals; starting backup must never snooze.
      const openBackup = store.backupRequested;
      store.preview(null);
      store.setActive(null);
      if (openBackup) router.raw.push('/(backup-flow)/intro');
      setNowMs(Date.now());
      return;
    }
    if (
      next === 'backup-recovery-phrase' &&
      navigation.routes.some((route) => route.name === '(backup-flow)')
    )
      return;
    if (!next || useCtaStore.getState().activeId !== null) return;
    useCtaStore.getState().setActive(next);
    // The queue reserves activeId before pushing; a just-closed CTA may legitimately
    // reopen within the tap guard's cooldown (notably Developer previews).
    router.raw.push({ pathname: '/cta', params: { id: next } });
  }, [
    hydrated,
    navigation,
    activeId,
    previewOverride,
    nowMs,
    latest,
    seedCreatedAt,
    recoveryPhraseVerifiedAt,
    recoveryPhraseVerifiedRevision,
    restoreStatus,
    balance.total,
    backupStartedAt,
    dismissed,
    mockMode,
    automation,
  ]);
  return null;
}
