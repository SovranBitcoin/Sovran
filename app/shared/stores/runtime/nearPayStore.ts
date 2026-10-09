import { defineStore as create } from '@/shared/lib/persist/defineStore';

import { storeLog } from '@/shared/lib/logger';

type NearPaySessionPhase = 'picking' | 'transitioning' | 'amount';

/** Every new nearby payment is locked to the authenticated recipient. */
export type NearPayDelivery = { locked: true };

interface NearPayRecipient {
  peerID: string;
  nickname: string;
  hasDirectLink: boolean;
  lastSeen: number;
  /** Request covered by the verified wallet capability before send. */
  creq?: string;
  nostrPubkeyHex?: string;
  walletCapabilityExpiresAt?: number;
  delivery: NearPayDelivery;
}

interface NearPaySession {
  id: string;
  recipient: NearPayRecipient;
  startedAt: number;
  phase: NearPaySessionPhase;
  presentation: 'radar' | 'route';
  amountEntry: string | null;
  /**
   * True while the mint picker route covers the radar for this session. The
   * amount step lands inline on the radar, not on a route of its own, so
   * nothing pushes the picker off the stack: whoever completes the step has to
   * pop it, and this is how they know it is there.
   */
  mintPickerOpen: boolean;
}

interface NearPaySessionStore {
  active: NearPaySession | null;
  /**
   * True while the Nut Drop radar screen is mounted. Surfaces outside the
   * screen key presentation on it — e.g. the receive toast is titled
   * "Received payment" only when the radar is what the user is looking at.
   */
  radarVisible: boolean;
  start: (recipient: NearPayRecipient, presentation?: 'radar' | 'route') => void;
  setAmountEntry: (amountEntry: string) => void;
  setMintPickerOpen: (open: boolean) => void;
  showAmount: () => void;
  resetToPicker: () => void;
  complete: () => void;
  clear: () => void;
  setRadarVisible: (visible: boolean) => void;
}

function createSessionId(peerID: string): string {
  return `${peerID}-${Date.now()}`;
}

export const useNearPaySessionStore = create<NearPaySessionStore>({
  name: 'useNearPaySessionStore',
  scope: 'session',
})((set, get) => ({
  active: null,
  radarVisible: false,

  start: (recipient, presentation = 'radar') => {
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
        presentation,
        amountEntry: null,
        mintPickerOpen: false,
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
        // A mint re-pick from the amount step replaces the entry in place: the
        // amount panel is already up, so replaying its entrance would flash it.
        phase: current.phase === 'amount' ? 'amount' : 'transitioning',
      },
    });
  },

  setMintPickerOpen: (open) => {
    const current = get().active;
    if (!current || current.mintPickerOpen === open) return;
    set({ active: { ...current, mintPickerOpen: open } });
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
