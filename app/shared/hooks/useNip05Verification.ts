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

/** Let a row settle before spending a request on it: a fast scroll mounts many. */
const FIRST_CHECK_DELAY_MS = 400;
/** Wait before re-asking when the shared queue was full. */
const BUSY_RETRY_MS = 5_000;

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
    // Everything this effect schedules is void once it is cleaned up: a row
    // that unmounts mid-check must not keep asking about its old identity.
    let disposed = false;
    const rerender = () => {
      if (!disposed) setGeneration((value) => value + 1);
    };
    const foreground = () => AppState.currentState === 'active' || AppState.currentState === null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (run: () => void, ms: number) =>
      timers.push(
        setTimeout(
          () => {
            if (!disposed) run();
          },
          Math.max(1, ms)
        )
      );
    // Ask the domain, then render whatever the cache now holds. When the
    // shared queue was too busy to run the check, the cache is unchanged:
    // wait and ask again rather than re-render straight back into this call.
    const check = (refresh: boolean) => {
      if (disposed || !foreground()) return; // The resume listener picks a pause up.
      const before = cachedNip05Check(identifier, pubkey)?.staleAt;
      void checkNip05Identity(identifier, pubkey, { refresh }).then(() => {
        if (disposed) return;
        const after = cachedNip05Check(identifier, pubkey)?.staleAt;
        if (after !== undefined && after !== before) rerender();
        else later(() => check(refresh), BUSY_RETRY_MS);
      });
    };

    if (cached) {
      const now = Date.now();
      // Re-check when the result goes stale; it keeps showing while that runs,
      // so a verified person never flickers back to "checking". What an
      // unreachable domain may keep is the cache's decision (see `settle`).
      if (cached.staleAt > now) later(() => check(true), cached.staleAt - now);
      else check(true);
      // Hard expiry is time passing, not a store change, so nothing would
      // re-render for it: a slow or queued refresh must not let the mark
      // outlive its limit.
      later(rerender, cached.expiresAt - now);
    } else {
      later(() => check(false), FIRST_CHECK_DELAY_MS);
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') rerender();
    });
    return () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
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
