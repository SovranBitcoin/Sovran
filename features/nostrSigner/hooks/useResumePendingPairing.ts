/**
 * @fileoverview Boot resume of a profile-switch pairing intent
 *
 * The profile picker persists a nostrconnect intent to raw AsyncStorage and
 * restarts the app into the target profile. This hook runs once per provider
 * mount (after keys + connections hydration), takes the intent (single-take —
 * storage is cleared before the intent is handed out), and:
 *   - 'taken'    → parse the URI → engine.startNostrconnectPairing (registers
 *                  the awaited client + its relays; safe on a cold engine) →
 *                  publish the parsed URI as `resumedPairing` in the requests
 *                  store. Layer 3 watches that field to open the connect
 *                  sheet; setting it also flips the service hook hot, so the
 *                  engine starts with the pairing relays already in the union.
 *   - 'expired' / 'mismatch' → `pairingNotice: 'expired'` (toast handoff —
 *                  plan copy: "Connection expired / Scan the QR code again").
 *   - 'none'     → nothing.
 *
 * Handoff mechanism (documented decision): both signals live in the
 * runtime-only nip46RequestsStore (`resumedPairing`, `pairingNotice`) rather
 * than a dedicated slice — Layer 3 already watches that store for the pending
 * queue, and the parsed URI's secret must stay runtime-only, which this store
 * guarantees by never persisting. No UI is rendered here.
 */

import { useEffect, useRef } from 'react';

import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import { parseNostrconnectUri } from '@/features/nostrSigner/lib/nip46Uri';
import {
  takePairingIntent,
  type TakePairingIntentOutcome,
} from '@/features/nostrSigner/lib/pairingIntentStorage';
import { nostrLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

import { useNip46ConnectionsHydrated } from './useNostrSignerService';

function handleOutcome(outcome: TakePairingIntentOutcome): void {
  const requests = useNip46RequestsStore.getState();
  switch (outcome.status) {
    case 'taken': {
      const parsed = parseNostrconnectUri(outcome.intent.uri);
      if (parsed.isErr()) {
        // The stored URI is gone either way (single-take); a dead intent and
        // an unparseable one read the same to the user. Error type only —
        // the raw URI embeds the pairing secret.
        nostrLog.warn('nostr.signer.resume_pairing_unparseable', { error: parsed.error.type });
        requests.setPairingNotice('expired');
        return;
      }
      const registered = nip46Engine.startNostrconnectPairing(parsed.value);
      if (registered.isErr()) {
        nostrLog.warn('nostr.signer.resume_pairing_register_failed', {
          error: registered.error.type,
        });
      }
      // Set AFTER registering: this flips the service hook hot, and start()
      // must find the awaited pairing already in the relay union.
      requests.setResumedPairing(parsed.value);
      nostrLog.info('nostr.signer.resume_pairing_taken');
      return;
    }
    case 'expired':
    case 'mismatch':
      nostrLog.info('nostr.signer.resume_pairing_dead', { status: outcome.status });
      requests.setPairingNotice('expired');
      return;
    case 'none':
      return;
  }
}

export function useResumePendingPairing(): void {
  const { keys } = useNostrKeysContext();
  const connectionsHydrated = useNip46ConnectionsHydrated();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    if (keys === null || !connectionsHydrated) return;
    attemptedRef.current = true;
    void takePairingIntent(keys.pubkey).match(handleOutcome, (error) => {
      nostrLog.error('nostr.signer.resume_pairing_failed', { error: error.type });
    });
  }, [keys, connectionsHydrated]);
}
