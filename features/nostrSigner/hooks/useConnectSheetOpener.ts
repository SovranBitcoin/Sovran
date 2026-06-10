/**
 * @fileoverview Connect-sheet opener — pairing handoffs → UI surfaces
 *
 * Mounted once inside NostrSignerProvider (beside the approval controller).
 * Watches the two runtime handoff fields `useResumePendingPairing` writes:
 *
 *   resumedPairing — a nostrconnect pairing that survived a profile-switch
 *     restart. The hot flag is raised BEFORE the field clears (it is a hot
 *     reason in the service hook; clearing first could stop the engine
 *     mid-handoff), then the 'signer-connect' sheet opens with the URI
 *     re-encoded from the parsed value — the sheet's contract is the raw URI
 *     string so every entry point shares one in-sheet validation path.
 *
 *   pairingNotice — a pairing intent that died (expired/mismatched). Cleared,
 *     then surfaced as the plan's "Connection expired" toast.
 *
 * The parsed URI and its re-encoding embed the pairing secret — never logged.
 */

import { useEffect } from 'react';

import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { encodeNostrconnectUri } from '@/features/nostrSigner/lib/nip46Uri';
import { nostrLog } from '@/shared/lib/logger';
import { popup, showActionSheet } from '@/shared/lib/popup';

const PAIRING_EXPIRED_TOAST = {
  label: 'Connection expired',
  description: 'Scan the QR code again to connect.',
} as const;

export function useConnectSheetOpener(): void {
  const resumedPairing = useNip46RequestsStore((s) => s.resumedPairing);
  const pairingNotice = useNip46RequestsStore((s) => s.pairingNotice);

  // ── Resumed pairing → open the connect sheet ──────────────────
  useEffect(() => {
    if (resumedPairing === null) return;
    const requests = useNip46RequestsStore.getState();
    // Hot first, clear second — see file header. The connect sheet takes
    // ownership of the flag on mount and releases it when the sheet closes.
    requests.setServiceHotRequested(true);
    requests.setResumedPairing(null);
    const uri = encodeNostrconnectUri(resumedPairing);
    if (uri.isErr()) {
      // Error type only — the parsed URI embeds the pairing secret.
      nostrLog.warn('nostr.signer.connect_opener_encode_failed');
      requests.setServiceHotRequested(false);
      requests.setPairingNotice('expired');
      return;
    }
    showActionSheet('signer-connect', { uri: uri.value });
  }, [resumedPairing]);

  // ── Dead pairing intent → "Connection expired" toast ──────────
  useEffect(() => {
    if (pairingNotice === null) return;
    useNip46RequestsStore.getState().setPairingNotice(null);
    popup({
      message: PAIRING_EXPIRED_TOAST.label,
      text: PAIRING_EXPIRED_TOAST.description,
      type: 'warning',
    });
  }, [pairingNotice]);
}
