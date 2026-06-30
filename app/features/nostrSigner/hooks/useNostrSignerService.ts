/**
 * @fileoverview NIP-46 signer service lifecycle glue
 *
 * The only place that starts/stops the engine singleton. Start requires ALL of:
 *   - NDK initialized (NostrNDKProvider defers init ~800ms — gate on its flag),
 *   - keys available (NostrKeysProvider),
 *   - connections store hydrated (reading `apps` pre-hydration would see the
 *     empty in-memory default and wrongly keep a paired user cold),
 *   - a reason to be hot: ≥1 active connection, a resumed pairing handoff, or
 *     the UI-requested hot flag (share/connect surfaces).
 * With zero connections and no pairing the engine never starts — no sockets,
 * no subscription, no liveness leak.
 *
 * Stop fires when the hot conditions lapse (last app disconnected), on keys
 * loss, and on unmount (profile switch remounts the provider subtree).
 *
 * AppState: foreground → engine.reconnect() (redial + re-subscribe at
 * min(lastEvent, now−300s); dedupe absorbs the overlap). Background → record a
 * timestamp only; iOS gives ~30s of socket life and JS timers freeze, so any
 * grace timer would be useless (plan: "best-effort background").
 *
 * The private key is read from the keys context and handed straight to
 * engine.start as a constructor parameter — never stored, logged, or placed in
 * any zustand state here.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import { nostrLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrNDKContext } from '@/shared/providers/NostrNDKProvider';

/**
 * True once the persisted connections store finished rehydrating. Same
 * pattern as `useWalletLifecycleHydrated` — `hasHydrated()` for the initial
 * snapshot, `onFinishHydration` for the async flip, plus the re-check that
 * closes the render→effect race.
 */
export function useNip46ConnectionsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useNip46ConnectionsStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return undefined;
    const unsubscribe = useNip46ConnectionsStore.persist.onFinishHydration(() => setHydrated(true));
    if (useNip46ConnectionsStore.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, [hydrated]);
  return hydrated;
}

/** Sorted relay union of active connections — change ⇒ the pool needs a rebuild. */
function activeRelayFingerprint(apps: Record<string, Nip46Connection>): string {
  const urls = new Set<string>();
  for (const app of Object.values(apps)) {
    if (app.status !== 'active') continue;
    for (const relay of app.relays) urls.add(relay);
  }
  return [...urls].sort().join(',');
}

function hasActiveApp(apps: Record<string, Nip46Connection>): boolean {
  return Object.values(apps).some((app) => app.status === 'active');
}

export function useNostrSignerService(): void {
  const { isInitialized: ndkInitialized } = useNostrNDKContext();
  const { keys } = useNostrKeysContext();
  const connectionsHydrated = useNip46ConnectionsHydrated();
  const hasActiveConnection = useNip46ConnectionsStore((s) => hasActiveApp(s.apps));
  const relayFingerprint = useNip46ConnectionsStore((s) => activeRelayFingerprint(s.apps));
  const serviceHotRequested = useNip46RequestsStore((s) => s.serviceHotRequested);
  const hasResumedPairing = useNip46RequestsStore((s) => s.resumedPairing !== null);

  const wantsHot = hasActiveConnection || serviceHotRequested || hasResumedPairing;
  const shouldRun = ndkInitialized && connectionsHydrated && keys !== null && wantsHot;

  // ── Engine start/stop ─────────────────────────────────────────
  // The cleanup IS the stop path: it runs when shouldRun flips false (hot
  // conditions lapsed / keys gone) and on unmount. A keys identity change
  // (refresh) cycles stop→start with the new key, which is the safe order.
  useEffect(() => {
    if (!shouldRun || keys === null) return undefined;
    const started = nip46Engine.start({
      signer: keys.privateKey,
      userPubkey: keys.pubkey,
    });
    if (started.isErr()) {
      // Error types only — engine errors carry pre-redacted causes, but the
      // service log stays shape-free by convention.
      nostrLog.error('nostr.signer.service_start_failed', { error: started.error.type });
      return undefined;
    }
    return () => {
      const stopped = nip46Engine.stop();
      if (stopped.isErr()) {
        nostrLog.warn('nostr.signer.service_stop_failed', { error: stopped.error.type });
      }
    };
  }, [shouldRun, keys]);

  // ── Relay-set tracking (UI-driven disconnect/block while running) ──
  // Pairing paths rebuild inside the engine already; this catches connection
  // edits made directly through the store (app detail screen). The ref guard
  // skips the mount run so a fresh start is not immediately rebuilt; an
  // overlapping rebuild after engine-internal ones is harmless (dedupe LRU).
  const previousFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousFingerprintRef.current;
    previousFingerprintRef.current = relayFingerprint;
    if (previous === null || previous === relayFingerprint) return;
    if (!nip46Engine.isStarted) return;
    const rebuilt = nip46Engine.rebuildRelays();
    if (rebuilt.isErr()) {
      nostrLog.warn('nostr.signer.service_rebuild_failed', { error: rebuilt.error.type });
    }
  }, [relayFingerprint]);

  // ── AppState ──────────────────────────────────────────────────
  const lastBackgroundedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        // Record only — sockets live as long as the OS allows (~30s on iOS)
        // and frozen JS timers make any grace timer a no-op.
        lastBackgroundedAtRef.current = Date.now();
        return;
      }
      if (next !== 'active') return;
      const backgroundedAt = lastBackgroundedAtRef.current;
      lastBackgroundedAtRef.current = null;
      if (!nip46Engine.isStarted) return;
      nostrLog.debug('nostr.signer.service_foreground_reconnect', {
        backgroundMs: backgroundedAt === null ? null : Date.now() - backgroundedAt,
      });
      const reconnected = nip46Engine.reconnect();
      if (reconnected.isErr()) {
        nostrLog.warn('nostr.signer.service_reconnect_failed', {
          error: reconnected.error.type,
        });
      }
    });
    return () => subscription.remove();
  }, []);
}
