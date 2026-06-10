/**
 * @fileoverview Switch & Connect — the profile-switch pairing seam (Layer 4)
 *
 * The profile picker confirmed a pairing for a NON-active profile. Profile
 * switches are restart-based (`profileSessionOrchestrator` → `restartApp`),
 * so the pairing has to cross the restart as a persisted intent. Order is
 * load-bearing:
 *
 *   1. re-encode the parsed nostrconnect URI (the connect sheet's wire
 *      contract — every entry point shares one in-sheet validation path)
 *   2. persist the pairing intent — AWAITED: the write must be durable
 *      before any teardown, or the pairing dies with this JS context
 *   3. close the connect sheet (clean release of the hot flag / awaited
 *      pairing via the sheet's own unmount path, before the orchestrator
 *      destroys the popup host)
 *   4. `switchToExistingProfile` → restart; `useResumePendingPairing` takes
 *      the intent on the next boot and reopens the connect sheet
 *
 * Failure handling: if the URI can't be re-encoded or the intent write fails,
 * the switch is ABORTED — the sheet stays open and a toast asks the user to
 * retry. If the orchestrator refuses the switch (transition already in
 * flight, wallet not ready for cleanup) or its promise rejects, the orphaned
 * intent is cleared best-effort so it can't resurface as a phantom
 * "Connection expired" toast on the next boot of THIS profile.
 *
 * The URI and the persisted intent embed the pairing secret — never logged.
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow';

import { encodeNostrconnectUri } from '@/features/nostrSigner/hooks/useConnectSheetOpener';
import type { ParsedNostrConnectUri } from '@/features/nostrSigner/lib/nip46Uri';
import {
  clearPairingIntent,
  setPairingIntent,
  type PairingIntentError,
} from '@/features/nostrSigner/lib/pairingIntentStorage';
import { nostrLog, redactError } from '@/shared/lib/logger';
import { popup } from '@/shared/lib/popup';
import { switchToExistingProfile } from '@/shared/lib/profile/profileSessionOrchestrator';

/**
 * New copy (Layer 4, documented): shown when the pairing intent can't be
 * saved before the restart — and reused for the rarer "switch refused"
 * abort so no second string ships for a path the orchestrator already logs.
 */
export const PAIRING_SAVE_FAILED_TOAST = {
  label: "Couldn't save the connection.",
  description: 'Try again.',
} as const;

export interface SwitchAndConnectTarget {
  /** Derivation/account index `switchToExistingProfile` switches to. */
  accountIndex: number;
  /**
   * Target profile's pubkey exactly as the profiles store carries it
   * (`ProfileEntry.pubkey` — present on derived AND imported rows, so no key
   * derivation happens here). The post-restart matcher in
   * `pairingIntentStorage` compares it case-insensitively.
   */
  pubkey: string;
}

export type SwitchProfileAndPairError =
  | { type: 'encode-failed' }
  | { type: 'intent-not-saved'; cause: PairingIntentError['type'] }
  | { type: 'switch-failed' };

function showSaveFailedToast(): void {
  popup({
    message: PAIRING_SAVE_FAILED_TOAST.label,
    text: PAIRING_SAVE_FAILED_TOAST.description,
    type: 'error',
  });
}

/** Orchestrator outcome as a plain value — a rejection reads as "no switch". */
function runProfileSwitch(accountIndex: number): ResultAsync<boolean, never> {
  return ResultAsync.fromPromise(switchToExistingProfile({ accountIndex }), (error) => {
    nostrLog.error('nostr.signer.switch_pair_switch_threw', { error: redactError(error) });
    return null;
  }).orElse(() => okAsync(false));
}

/**
 * The switch never started, but the sheet is already closed and the intent is
 * already on disk. Clear it (best-effort — the storage layer logs its own
 * failures) so the secret-bearing blob doesn't outlive the attempt, then
 * surface the retry toast.
 */
function abortAfterRefusedSwitch(): ResultAsync<void, SwitchProfileAndPairError> {
  nostrLog.warn('nostr.signer.switch_pair_switch_refused');
  return clearPairingIntent()
    .orElse(() => okAsync(undefined))
    .andThen(() => {
      showSaveFailedToast();
      return errAsync<void, SwitchProfileAndPairError>({ type: 'switch-failed' });
    });
}

/**
 * Persist-then-restart seam fired by the profile picker's "Switch & Connect".
 * On the happy path the resolved value is academic — the app restarts. The
 * error channel exists for the abort paths, where the caller's sheet is the
 * UI that survives.
 */
export function switchProfileAndPair(
  parsed: ParsedNostrConnectUri,
  target: SwitchAndConnectTarget,
  closeSheet: () => void
): ResultAsync<void, SwitchProfileAndPairError> {
  const encoded = encodeNostrconnectUri(parsed);
  if (encoded.isErr()) {
    // Event name only — the URI embeds the pairing secret.
    nostrLog.warn('nostr.signer.switch_pair_encode_failed');
    showSaveFailedToast();
    return errAsync<void, SwitchProfileAndPairError>({ type: 'encode-failed' });
  }
  return setPairingIntent({
    uri: encoded.value,
    targetPubkey: target.pubkey,
    targetAccountIndex: target.accountIndex,
  })
    .mapErr((error): SwitchProfileAndPairError => {
      // setPairingIntent already logged the redacted cause.
      showSaveFailedToast();
      return { type: 'intent-not-saved', cause: error.type };
    })
    .andThen(() => {
      // The intent write is durable — safe to tear the sheet down. Its
      // unmount path (releaseIfSheetClosed) cancels the awaited pairing and
      // drops the hot flag; the post-restart resume re-creates both.
      closeSheet();
      nostrLog.info('nostr.signer.switch_pair_intent_saved', {
        targetAccountIndex: target.accountIndex,
      });
      return runProfileSwitch(target.accountIndex);
    })
    .andThen((switched) =>
      switched ? okAsync<void, SwitchProfileAndPairError>(undefined) : abortAfterRefusedSwitch()
    );
}
