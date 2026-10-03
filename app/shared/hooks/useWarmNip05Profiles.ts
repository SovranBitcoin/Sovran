import { useEffect } from 'react';
import { AppState } from 'react-native';
import { cachedNip05Check, checkNip05Identity } from '@/shared/lib/nostr/profile/nip05Verification';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

/** Warm only the bounded nearby directory, before payment screens mount. */
export function useWarmNip05Profiles(profiles: ReadonlyMap<string, { nip05?: string }>): void {
  const mockMode = useSettingsStore((state) => state.mockMode);
  useEffect(() => {
    if (mockMode || !profiles.size) return;
    const warm = () => {
      if (AppState.currentState !== 'active') return;
      for (const [pubkey, profile] of profiles) {
        if (!profile.nip05) continue;
        const cached = cachedNip05Check(profile.nip05, pubkey);
        // Renew a successful assertion before expiry without extending its trust
        // while the request is pending. Allow for the poll interval and queued
        // network work. Failures retain the normal retry TTL.
        const refresh =
          cached?.result.status === 'verified' && cached.expiresAt - Date.now() <= 120_000;
        void checkNip05Identity(profile.nip05, pubkey, { refresh });
      }
    };
    warm();
    const timer = setInterval(warm, 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') warm();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [mockMode, profiles]);
}
