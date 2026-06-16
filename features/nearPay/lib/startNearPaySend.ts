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
