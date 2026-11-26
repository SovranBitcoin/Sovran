/**
 * @fileoverview The one way to start paying a person picked from a list.
 *
 * Send's search results and recents and the detected-action rows (Send and
 * the Search tab) start here, and a profile's Send Money arms the same
 * delivery through `armContactDelivery`, so a person is paid the same way
 * wherever they were found: amount entry with their profile on it, a
 * Lightning target (their own address, or npub.cash for any Nostr key), and,
 * when ecash messages ship, the contact-delivery context that sends a bearer
 * token to them over an encrypted DM.
 */
import type { usePaymentFlowMachine } from 'wallet/react';

import { hasFeature } from '@/shared/config/features';
import { extractLightningTarget } from 'wallet';

import { npcAddressForPubkey } from '@/shared/lib/cashu/npc';
import { peekCachedLightningTarget } from '@/shared/lib/nostr/profileLightningTarget';
import { prefetchNutzapProfile } from '@/shared/lib/nostr/nutzapProfileDiscovery';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';

export interface ContactSendTarget {
  pubkey: string;
  displayName: string | null;
  picture: string | null;
  nip05: string | null;
  lud16: string | null;
  /** Legacy LNURL-pay field; used only when `lud16` is unusable. */
  lud06?: string | null;
}

type PaymentFlowMachine = Pick<ReturnType<typeof usePaymentFlowMachine>, 'startSendEcash'>;

interface StartContactSendOptions {
  /**
   * Set when this tap is the root of a payment (a surface outside the send
   * flow, such as Search). Routing context left by an abandoned flow is
   * cleared first and Colada starts a fresh draft. Send itself leaves it unset:
   * the wallet's Send button already started that flow.
   */
  root?: string;
}

/**
 * When ecash messages ship, arms the contact-delivery context so a finished
 * bearer send reaches the person over an encrypted NIP-17 DM. Without them
 * the contact is paid over Lightning only, so nothing is armed.
 */
export function armContactDelivery(contact: {
  pubkey: string;
  displayName: string | null;
  picture: string | null;
  nip05: string | null;
  /** The address they published (lud16 / lud06), never the npub.cash fallback. */
  lud16: string | null;
}): void {
  if (!hasFeature('ecashMessages')) return;
  const { pubkey, displayName, picture, nip05, lud16 } = contact;
  useContactSendStore.getState().start({
    pubkey,
    delivery: 'nip17',
    ...(displayName ? { displayName } : {}),
    avatarUrl: picture,
    nip05,
    ...(lud16 ? { lud16 } : {}),
  });
}

export function startContactSend(
  machine: PaymentFlowMachine,
  target: ContactSendTarget,
  options: StartContactSendOptions = {}
): Promise<unknown> {
  const { pubkey, displayName, picture, nip05 } = target;
  if (options.root) clearPaymentContext(options.root);
  // The lock option's kind:10019 lookup is the slowest thing on the amount
  // screen. Start it here, where the recipient first becomes known, so the
  // answer is usually already cached by the time the menu asks.
  prefetchNutzapProfile(pubkey);
  // A row from local search may not carry their address; the entity cache
  // often does. Only when neither has one fall back to npub.cash, which can
  // receive for any Nostr key. That fallback is one we chose, not one they
  // published, so it is flagged explicitly and the Lightning option carries
  // the caveat (see `availability.ts`). A published `@npub.cash` address is
  // not flagged.
  const lud16 = extractLightningTarget(target) ?? peekCachedLightningTarget(pubkey);
  const npcFallback = lud16 ? undefined : npcAddressForPubkey(pubkey);
  const lightningTarget = lud16 ?? npcFallback;
  armContactDelivery({ pubkey, displayName, picture, nip05, lud16: lud16 ?? null });
  return machine.startSendEcash({
    ...(options.root ? { reset: true } : {}),
    recipientPubkey: pubkey,
    recipientProfile: { displayName: displayName ?? '', avatarUrl: picture, nip05 },
    ...(lightningTarget ? { meltTarget: lightningTarget } : {}),
    ...(npcFallback ? { meltTargetIsNpcFallback: true } : {}),
  });
}
