import { create } from 'zustand';

import { storeLog } from '@/shared/lib/logger';

type NearPaySessionPhase = 'picking' | 'transitioning' | 'amount';

/**
 * How this session's token is locked. Every Nut Drop send is delivered the same
 * way — a private Noise DM to a creq-confirmed Sovran peer — so the distinction
 * is the token lock:
 * - `locked: true`: P2PK-locked to the recipient's announced key (a Sovran
 *   peer). Only they can redeem it.
 * - `locked: false`: an unlocked bearer token from a shared mint, used only
 *   when the peer advertised a valid creq but we cannot P2PK-lock offline.
 */
export type NearPayDelivery = { locked: boolean };

interface NearPayRecipient {
  peerID: string;
  nickname: string;
  hasDirectLink: boolean;
  lastSeen: number;
  /** Capability proof: the peer advertised a valid creq favorite before send. */
  creq?: string;
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
   * screen key presentation on it — e.g. the receive toast is titled
   * "Received payment" only when the radar is what the user is looking at.
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
      peerHasCreq: !!recipient.creq,
      locked: recipient.delivery.locked,
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
