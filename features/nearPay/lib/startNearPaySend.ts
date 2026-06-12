import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';

/**
 * Consent gates for the two unlocked Nut Drop delivery modes. Locked mesh
 * sends never prompt — the token is P2PK-locked to the key the recipient
 * just issued, so nobody else can claim it. Both gates resolve `true` only
 * on the explicit confirm tap; overlay tap, swipe-down, or Cancel resolve
 * `false`, leaving the radar untouched.
 */
function consentGate(options: {
  title: string;
  confirmTestID: string;
  cancelTestID: string;
  confirmText: string;
  description: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };
    actionMenuPopup({
      title: options.title,
      buttons: [
        {
          testID: options.confirmTestID,
          text: options.confirmText,
          description: options.description,
          icon: 'mdi:lock-open-variant-outline',
          variant: 'dangerous',
          onPress: (close) => {
            settle(true);
            close();
          },
        },
        {
          testID: options.cancelTestID,
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

/**
 * Bearer-DM consent (capable peer, sender offline): the token travels over
 * the encrypted Noise session — only the recipient sees it — but it is not
 * locked, so anyone who later obtains it could claim it.
 */
export function confirmBearerSend(displayName: string): Promise<boolean> {
  return consentGate({
    title: 'Send without a lock?',
    confirmTestID: 'near-pay-bearer-confirm',
    cancelTestID: 'near-pay-bearer-cancel',
    confirmText: 'Send bearer token',
    description: `You're offline, so the sats can't be locked to ${displayName}. They're sent privately to ${displayName}'s device as a bearer token anyone could claim if it leaked.`,
  });
}

/**
 * Public-broadcast consent (vanilla bitchat peer): the strongest warning —
 * the bearer token is visible to EVERY peer in mesh range, not just the
 * recipient, and the fastest redeemer wins.
 */
export function confirmPublicBroadcastSend(displayName: string): Promise<boolean> {
  return consentGate({
    title: 'Broadcast to everyone nearby?',
    confirmTestID: 'near-pay-broadcast-confirm',
    cancelTestID: 'near-pay-broadcast-cancel',
    confirmText: 'Broadcast bearer token',
    description: `${displayName}'s app can't receive private payments. The sats are broadcast publicly as a bearer token — anyone nearby who sees it first can claim it.`,
  });
}
