import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';

/**
 * Informs the user that a Nut Drop can't be sent because we share no mint the
 * recipient accepts (read from their `creq`). A token from a mint they don't
 * accept would be unredeemable, so the send is blocked. Single acknowledge.
 *
 * (Nut Drops deliver as a private Noise DM encrypted to the recipient, so there
 * is no public-exposure consent — only this mint-compatibility notice.)
 */
export function notifyNoSharedMint(displayName: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    actionMenuPopup({
      title: 'No shared mint',
      buttons: [
        {
          testID: 'near-pay-no-shared-mint-ok',
          text: 'OK',
          description: `You and ${displayName} don't have a mint in common, so they couldn't redeem the payment. Add one of their mints to pay them.`,
          icon: 'mdi:bank-off-outline',
          variant: 'secondary',
          onPress: (close) => {
            settle();
            close();
          },
        },
      ],
      onDismiss: () => settle(),
    });
  });
}

/**
 * Asks the user to confirm an offline Nut Drop that downgrades from a P2PK
 * **lock** to a **bearer** token. A P2PK lock needs an online mint swap, so
 * offline we can only send bearer — but a bearer token is redeemable by anyone
 * who gets the bytes, so per the sovran-payments invariant this must never be
 * silent. Resolves true to proceed (bearer), false to cancel. The token still
 * rides a private Noise DM either way.
 */
export function confirmBearerDowngrade(displayName: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    actionMenuPopup({
      title: 'Send unlocked while offline?',
      buttons: [
        {
          testID: 'near-pay-bearer-consent-send',
          text: 'Send unlocked',
          description: `You're offline, so this can't be locked to ${displayName}. It'll send as a bearer token — redeemable by whoever receives it. It still goes only to ${displayName} over an encrypted link.`,
          icon: 'mdi:lock-open-variant-outline',
          variant: 'secondary',
          onPress: (close) => {
            settle(true);
            close();
          },
        },
        {
          testID: 'near-pay-bearer-consent-cancel',
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
 * Blocks a Nut Drop to a peer that has not advertised a valid creq favorite.
 * That favorite is the capability signal that the receiver understands Sovran's
 * extended private-message length; without it an extended token DM could be
 * dropped by a stock or stale client.
 */
export function notifyNutDropPeerNotReady(displayName: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    actionMenuPopup({
      title: 'Not ready for Nut Drop',
      buttons: [
        {
          testID: 'near-pay-peer-not-ready-ok',
          text: 'OK',
          description: `${displayName} has not advertised a Sovran payment request yet. Keep both apps open nearby and try again.`,
          icon: 'mdi:bluetooth-off',
          variant: 'secondary',
          onPress: (close) => {
            settle();
            close();
          },
        },
      ],
      onDismiss: () => settle(),
    });
  });
}
