import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';

/**
 * Consent gate for an unlocked (bearer) Nut Drop. Locked sends never prompt —
 * the token is P2PK-locked to the recipient's announced key, so nobody else
 * can claim it. The gate resolves `true` only on the explicit confirm tap;
 * overlay tap, swipe-down, or Cancel resolve `false`, leaving the radar
 * untouched.
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
 * Public-broadcast consent (vanilla bitchat peer with no announced key): the
 * bearer token is visible to EVERY peer in mesh range, not just the
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
