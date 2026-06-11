import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import type { NearPayDelivery } from '@/shared/stores/runtime/nearPayStore';

/**
 * How a Nut Drop to this peer must be built. Decided purely from the peer's
 * announced ecash capability:
 * - `p2pk`: lock the token to the announced key; the recipient's Nostr
 *   pubkey (lock key minus the "02" parity prefix) resolves their profile.
 * - `bearer`: vanilla bitchat peer — no lock key exists, the token would be
 *   broadcast unlocked. Callers MUST get explicit user confirmation
 *   (`confirmBearerSend`) before starting a bearer session.
 */
type NearPaySendPlan =
  | { mode: 'p2pk'; p2pkLockPubkey: string; recipientPubkey: string }
  | { mode: 'bearer' };

/** Structural input so both `BLEPeer` and `NearPayLayoutPeer` fit. */
export function nearPaySendPlan(peer: {
  supportsP2pkEcash: boolean;
  p2pkPubkeyHex?: string;
}): NearPaySendPlan {
  // Both checks: the capability flag and the key travel together (bridge
  // invariant), but a lock key must never be synthesized from a peer that
  // only half-claims the capability.
  if (peer.supportsP2pkEcash && peer.p2pkPubkeyHex) {
    return {
      mode: 'p2pk',
      p2pkLockPubkey: peer.p2pkPubkeyHex,
      recipientPubkey: peer.p2pkPubkeyHex.slice(2),
    };
  }
  return { mode: 'bearer' };
}

/** The session-store delivery descriptor for a computed plan. */
export function planDelivery(plan: NearPaySendPlan): NearPayDelivery {
  return plan.mode === 'p2pk'
    ? { mode: 'p2pk', p2pkPubkeyHex: plan.p2pkLockPubkey }
    : { mode: 'bearer' };
}

/**
 * Explicit consent gate for bearer drops. Resolves `true` only when the user
 * taps the send button; overlay tap, swipe-down, or Cancel resolve `false`.
 * Resolve-once guard: the host fires `onPress` before its auto-dismiss, and
 * `onDismiss` doesn't fire after an in-flight selection — but keep the gate
 * defensive so a double event can never start two sessions.
 */
export function confirmBearerSend(displayName: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };
    actionMenuPopup({
      title: 'Send without a lock?',
      buttons: [
        {
          testID: 'near-pay-bearer-confirm',
          text: 'Send bearer token',
          description: `${displayName}'s app can't receive locked payments. The sats are broadcast as a bearer token — anyone nearby who sees it first can claim it.`,
          icon: 'mdi:lock-open-variant-outline',
          variant: 'dangerous',
          onPress: (close) => {
            settle(true);
            close();
          },
        },
        {
          testID: 'near-pay-bearer-cancel',
          text: 'Cancel',
          icon: 'mdi:close',
          variant: 'secondary',
          onPress: (close) => {
            settle(false);
            close();
          },
        },
      ],
      onDismiss: () => settle(false),
    });
  });
}
