import { create } from 'zustand';

import { storeLog } from '@/shared/lib/logger';

type NearPaySessionPhase = 'picking' | 'transitioning' | 'amount';

interface NearPayRecipient {
  peerID: string;
  nickname: string;
  hasDirectLink: boolean;
  lastSeen: number;
  /**
   * The recipient's Cashu P2PK lock target from their SVRN announce
   * ("02" + their x-only Nostr pubkey). Required — Nut Drop sessions can
   * only start for Sovran peers, and the broadcast token is locked to this
   * key so only the chosen recipient can redeem it.
   */
  p2pkPubkeyHex: string;
}

interface NearPaySession {
  id: string;
  recipient: NearPayRecipient;
  startedAt: number;
  phase: NearPaySessionPhase;
  amountEntry: string | null;
}

interface NearPaySessionStore {
  active: NearPaySession | null;
  start: (recipient: NearPayRecipient) => void;
  setAmountEntry: (amountEntry: string) => void;
  showAmount: () => void;
  resetToPicker: () => void;
  complete: () => void;
  clear: () => void;
}

function createSessionId(peerID: string): string {
  return `${peerID}-${Date.now()}`;
}

export const useNearPaySessionStore = create<NearPaySessionStore>((set, get) => ({
  active: null,

  start: (recipient) => {
    storeLog.info('near_pay.session.start', {
      peerID: recipient.peerID,
      hasDirectLink: recipient.hasDirectLink,
      p2pkPubkeyPresent: recipient.p2pkPubkeyHex.length > 0,
    });
    set({
      active: {
        id: createSessionId(recipient.peerID),
        recipient,
        startedAt: Date.now(),
        phase: 'picking',
        amountEntry: null,
      },
    });
  },

  setAmountEntry: (amountEntry) => {
    const current = get().active;
    if (!current) {
      storeLog.warn('near_pay.session.amount_entry_without_session');
      return;
    }
    storeLog.info('near_pay.session.amount_entry');
    set({
      active: {
        ...current,
        amountEntry,
        phase: 'transitioning',
      },
    });
  },

  showAmount: () => {
    const current = get().active;
    if (!current) return;
    set({
      active: {
        ...current,
        phase: 'amount',
      },
    });
  },

  resetToPicker: () => {
    const current = get().active;
    if (current) {
      storeLog.info('near_pay.session.reset_to_picker', {
        peerID: current.recipient.peerID,
      });
    }
    set({ active: null });
  },

  complete: () => {
    const current = get().active;
    if (!current) return;
    storeLog.info('near_pay.session.complete', {
      peerID: current.recipient.peerID,
      durationMs: Date.now() - current.startedAt,
    });
    set({ active: null });
  },

  clear: () => {
    if (get().active) storeLog.debug('near_pay.session.clear');
    set({ active: null });
  },
}));
