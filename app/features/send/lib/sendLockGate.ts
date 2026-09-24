/**
 * Whether this send can be locked to its recipient, and what to say when it
 * cannot.
 *
 * Modelled on `features/receive/lib/creqMintSelection.ts`, which answers the
 * mirror-image question for the receive side. Two kinds of "no" that must not
 * be confused:
 *
 *   - `unavailable` — locking would fail or lie. Coco's P2pkSendHandler throws
 *     unless the mint advertises NUT-11, so offering the toggle there promises
 *     something the send cannot deliver.
 *   - `unconfirmed` — locking will work, but we cannot confirm the recipient
 *     can unlock it. That is a warning, never a block: the user may well know
 *     something we do not, and refusing on their behalf is not ours to do.
 *
 * Pure: no hooks, no I/O, so every branch is a unit test.
 */

import { nutSupported, type MintNuts } from '@/shared/lib/cashu/mintNuts';
import type { NutzapProfile } from '@/shared/lib/nostr/nip61NutzapProfile';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

export const REASON_NO_RECIPIENT = 'Locking needs a Nostr recipient';
export const REASON_MINT_NO_P2PK = "This mint doesn't support P2PK locks";
const REASON_LOOKING_UP = 'Checking how they receive ecash…';
export const WARNING_UNCONFIRMED =
  'Locked to their Nostr identity key. They need a wallet that can sign with that key.';
export const WARNING_MINT_NOT_LISTED = "They haven't listed this mint";

export type SendLockGate =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; lockKey: CashuP2pkPubkey }
  | { kind: 'unconfirmed'; lockKey: CashuP2pkPubkey; warning: string };

interface SendLockGateInput {
  /** The recipient's nostr identity, when the flow knows one. */
  recipientPubkey?: string;
  /** Their kind:10019 answer, or our fallback; null while unresolved. */
  nutzapProfile: NutzapProfile | null;
  nutzapLoading: boolean;
  selectedMintUrl?: string;
  /**
   * The selected mint's NUT-06 `nuts` map. `undefined` means we have not read
   * it yet — which is NOT the same as "does not support NUT-11", and must not
   * disable the control.
   */
  selectedMintNuts?: MintNuts;
}

export function deriveSendLockGate(input: SendLockGateInput): SendLockGate {
  const { recipientPubkey, nutzapProfile, nutzapLoading, selectedMintUrl, selectedMintNuts } =
    input;

  if (!recipientPubkey) {
    return { kind: 'unavailable', reason: REASON_NO_RECIPIENT };
  }

  // Tri-state on purpose. Only a mint we have read and that says no is a
  // blocker; an unread mint stays open, the way method capabilities do.
  if (selectedMintUrl && selectedMintNuts !== undefined && !nutSupported(selectedMintNuts, '11')) {
    return { kind: 'unavailable', reason: REASON_MINT_NO_P2PK };
  }

  if (!nutzapProfile) {
    return {
      kind: 'unavailable',
      reason: nutzapLoading ? REASON_LOOKING_UP : REASON_NO_RECIPIENT,
    };
  }

  const lockKey = nutzapProfile.lockKey;

  if (nutzapProfile.source === 'identityFallback') {
    return { kind: 'unconfirmed', lockKey, warning: WARNING_UNCONFIRMED };
  }

  // They published the mints they accept, and this is not one of them. They
  // can still claim it — the lock is to their key, not to a mint — but they
  // said they would rather not, so say so.
  if (
    nutzapProfile.mints.length > 0 &&
    selectedMintUrl &&
    !nutzapProfile.mints.includes(selectedMintUrl)
  ) {
    return { kind: 'unconfirmed', lockKey, warning: WARNING_MINT_NOT_LISTED };
  }

  return { kind: 'ready', lockKey };
}
