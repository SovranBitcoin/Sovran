import { create } from 'zustand';

import { storeLog } from '@/shared/lib/logger';

/**
 * The remote Nostr contact a destination-first Send is addressed to. Set by the
 * Send screen when the user taps a searched contact and starts an amount entry,
 * and consulted by the `sendComplete` step handler: when an ecash (bearer) send
 * finishes while this is active, the token is delivered to the contact over a
 * NIP-17 gift-wrapped DM (and the user lands in that chat thread) instead of the
 * normal bearer hand-off screen.
 *
 * This is the remote-contact analogue of `nearPaySessionStore` (which delivers
 * over the BLE mesh). It carries no funds-routing risk on its own — delivery is
 * an encrypted DM to the contact's own npub, so the token stays bearer — but it
 * is still payment ROUTING context, so it MUST be cleared at every payment root
 * via `clearPaymentContext`.
 */
export interface ContactSendTarget {
  /** Recipient Nostr pubkey (hex). */
  pubkey: string;
  displayName?: string;
  avatarUrl?: string | null;
  nip05?: string | null;
  /**
   * Lightning address (lud16) when the contact advertised one. Present only so
   * the amount screen can offer Lightning as the recommended rail; ecash
   * delivery never uses it.
   */
  lud16?: string;
}

interface ContactSendStore {
  active: ContactSendTarget | null;
  /** Begin addressing an ecash-capable Send to a remote contact. */
  start: (target: ContactSendTarget) => void;
  /** Drop the target (send finished/aborted, or a new root cleared context). */
  clear: () => void;
}

export const useContactSendStore = create<ContactSendStore>((set) => ({
  active: null,

  start: (target) => {
    storeLog.info('contact_send.start', {
      hasLud16: !!target.lud16,
      hasProfile: !!target.displayName,
    });
    set({ active: target });
  },

  clear: () => {
    set((state) => (state.active ? { active: null } : state));
  },
}));
