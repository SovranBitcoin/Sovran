import { create } from 'zustand';

import { storeLog } from '@/shared/lib/logger';

type NearPaySessionPhase = 'picking' | 'transitioning' | 'amount';

/**
 * How the broadcast token must be protected for this session. Discriminated
 * so every consumer is forced to handle both modes explicitly:
 * - `p2pk`: the recipient announced the ecash capability TLV; the token is
 *   locked to their announced key ("02" + x-only Nostr pubkey) so only they
 *   can redeem it.
 * - `bearer`: vanilla bitchat recipient — the token is broadcast UNLOCKED
 *   and anyone on the mesh can claim it. Only ever chosen after the sender
 *   explicitly confirmed the bearer warning.
 */
export type NearPayDelivery = { mode: 'p2pk'; p2pkPubkeyHex: string } | { mode: 'bearer' };

interface NearPayRecipient {
  peerID: string;
  nickname: string;
  hasDirectLink: boolean;
  lastSeen: number;
  delivery: NearPayDelivery;
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
  /**
   * True while the Nut Drop radar screen is mounted. Surfaces outside the
   * screen key presentation on it — e.g. the receive toast picks up the
   * radar's blue accent (tint + checkmark) only when the radar is what the
   * user is looking at.
   */
  radarVisible: boolean;
  start: (recipient: NearPayRecipient) => void;
  setAmountEntry: (amountEntry: string) => void;
  showAmount: () => void;
  resetToPicker: () => void;
  complete: () => void;
  clear: () => void;
  setRadarVisible: (visible: boolean) => void;
}

function createSessionId(peerID: string): string {
  return `${peerID}-${Date.now()}`;
}

export const useNearPaySessionStore = create<NearPaySessionStore>((set, get) => ({
  active: null,
  radarVisible: false,

  start: (recipient) => {
    storeLog.info('near_pay.session.start', {
      peerID: recipient.peerID,
      hasDirectLink: recipient.hasDirectLink,
      deliveryMode: recipient.delivery.mode,
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

  setRadarVisible: (visible) => {
    if (get().radarVisible !== visible) set({ radarVisible: visible });
  },
}));
