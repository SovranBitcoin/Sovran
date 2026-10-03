import { acknowledgeSheet as acknowledge } from '@/shared/lib/popup/popups/acknowledgeSheet';

/**
 * Informs the user that a Nut Drop can't be sent because we share no mint the
 * recipient accepts (read from their `creq`). A token from a mint they don't
 * accept would be unredeemable, so the send is blocked. Single acknowledge.
 *
 * (Nut Drops deliver as a private Noise DM encrypted to the recipient, so there
 * is no public-exposure consent — only this mint-compatibility notice.)
 */
export function notifyNoSharedMint(displayName: string): Promise<void> {
  return acknowledge({
    title: 'No shared mint',
    testID: 'near-pay-no-shared-mint-ok',
    description: `You and ${displayName} don't have a mint in common, so they couldn't redeem the payment. Add one of their mints to pay them.`,
    icon: 'mdi:bank-off-outline',
  });
}

/**
 * Nut Drops are denominated in sats (the machine is pinned to `sat`), but the
 * wallet context the send draws on is scoped to the ACTIVE account's unit. On a
 * fiat account those balances are cents, which the pinned machine would read as
 * sats — so the send is blocked until a Bitcoin account (real or test) is
 * active. Single acknowledge.
 */
export function notifyNutDropNeedsBitcoinAccount(): Promise<void> {
  return acknowledge({
    title: 'Switch to Bitcoin',
    testID: 'near-pay-needs-bitcoin-account-ok',
    description: 'Nut Drops send sats. Switch to your Bitcoin account to pay someone nearby.',
    icon: 'mdi:bitcoin',
  });
}

export function notifyNearbyNeedsConnection(): Promise<void> {
  return acknowledge({
    title: 'Connect to lock this payment',
    testID: 'near-pay-needs-connection-ok',
    description:
      'An internet connection is needed to create a payment only this recipient can unlock.',
    icon: 'mdi:lock-outline',
  });
}

/** A fresh, authenticated wallet capability is required before creating a send. */
export function notifyNutDropPeerNotReady(displayName: string): Promise<void> {
  return acknowledge({
    title: 'Not ready for Nut Drop',
    testID: 'near-pay-peer-not-ready-ok',
    description: `${displayName} has not advertised a Sovran payment request yet. Keep both apps open nearby and try again.`,
    icon: 'mdi:bluetooth-off',
  });
}
