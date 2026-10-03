import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { parseNip05Identifier, type Nip05Verification } from 'wallet';
import {
  cachedNip05Check,
  checkNip05Identity,
  forgetNip05Check,
  subscribeNip05Check,
} from '@/shared/lib/nostr/profile/nip05Verification';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

export type Nip05State = Nip05Verification | { status: 'pending' | 'none' };

/** Results are always read using both current inputs, including the first render after a change. */
export function useNip05Verification(address: string | undefined, pubkey: string | undefined) {
  const mockMode = useSettingsStore((state) => state.mockMode);
  const identifier = address ? (parseNip05Identifier(address)?.identifier ?? address.trim()) : '';
  const [generation, setGeneration] = useState(0);
  const cached = useSyncExternalStore(
    (listener) => subscribeNip05Check(identifier, pubkey ?? '', listener),
    () => (identifier && pubkey ? cachedNip05Check(identifier, pubkey) : undefined),
    () => undefined
  );
  useEffect(() => {
    if (!identifier || !pubkey || mockMode) return;
    const refresh = () => setGeneration((value) => value + 1);
    // Expiry first removes the checkmark; an unavailable refresh cannot extend trust.
    const timer = cached
      ? setTimeout(refresh, Math.max(1, cached.expiresAt - Date.now()))
      : setTimeout(() => {
          if (AppState.currentState === 'active' || AppState.currentState === null)
            void checkNip05Identity(identifier, pubkey);
        }, 400);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setGeneration((value) => value + 1);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [identifier, pubkey, mockMode, generation, cached]);
  const state: Nip05State =
    !identifier || !pubkey ? { status: 'none' } : (cached?.result ?? { status: 'pending' });
  const retry = () => {
    if (identifier && pubkey) forgetNip05Check(identifier, pubkey);
    setGeneration((value) => value + 1);
  };
  return { state, retry };
}
