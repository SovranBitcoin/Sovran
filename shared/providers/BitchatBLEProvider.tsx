/**
 * @fileoverview App-wide bitchat BLE mesh lifecycle.
 *
 * Starts the BLE mesh once at app boot so peers populate throughout the app
 * without requiring the user to open the mesh-chat or Network screens. The
 * mesh stays alive for the lifetime of the account scope — it only stops
 * when the user switches profiles (the provider unmounts with the account
 * scope).
 *
 * Why a provider instead of per-screen start/stop:
 *   - The Split-Bill participant picker, contacts-screen peer hints, and any
 *     future "who's nearby?" affordances all want to see peers without
 *     bouncing through the BLE chat screen first.
 *   - `getBLEPeers()` and `addBLEPeerListener` are cheap once the mesh is
 *     running. Starting it once costs a BLE permission prompt and ~1s of
 *     advertising setup — amortised across the session.
 *   - `useBitChat(transport='ble')` previously called `stopBLE()` on
 *     cleanup, which would yank the mesh from underneath any other
 *     consumer. That's why this provider exists at all — see the comment
 *     in `useBitChat` where the public-BLE cleanup is now a no-op.
 *
 * Parity with `useBLEPeers`: this module only starts the mesh; peer-list
 * consumers still use `useBLEPeers()` as before.
 */

import React, { useEffect } from 'react';
import { startBLE } from 'bitchat-module';
import { useBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { log, initLog, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'BitchatBLEProvider loaded');

const bleLog = log.child({ module: 'bitchat' });

/**
 * Invisible component. Mount inside `AccountScopedProviders` (not outer
 * providers) so BLE restarts when the profile switches — each profile has
 * its own identity keys and therefore its own advertised peerID.
 */
export function BitchatBLEProvider({ children }: { children: React.ReactNode }) {
  useInitMount('BitchatBLEProvider');
  const nickname = useBitchatNickname();

  useEffect(() => {
    let cancelled = false;

    // Nickname is derived async from the profile; skip first render until
    // we have something to advertise. A missing nickname still starts BLE
    // (upstream bitchat generates one), but we prefer to avoid the
    // re-announce that happens when nickname changes post-start.
    if (!nickname) return;

    bleLog.info('bitchat.provider.ble_start', { hasNickname: !!nickname });
    startBLE(nickname)
      .then(() => {
        if (cancelled) return;
        bleLog.info('bitchat.provider.ble_started');
      })
      .catch((err) => {
        bleLog.error('bitchat.provider.ble_start_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      // Deliberately DON'T stopBLE here either. The provider is mounted
      // inside AccountScopedProviders, so it only unmounts on profile
      // switch — at which point the whole account scope restarts anyway.
      // Calling stopBLE() during the switch window was causing race
      // conditions where the new scope re-started BLE before the old
      // one's stop had settled.
    };
  }, [nickname]);

  return <>{children}</>;
}
