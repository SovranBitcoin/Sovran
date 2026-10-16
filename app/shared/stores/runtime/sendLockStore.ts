import { defineStore as create } from '@/shared/lib/persist/defineStore';

import { storeLog } from '@/shared/lib/logger';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

/**
 * The lock the user chose for the send they are composing.
 *
 * Runtime only — never persisted. A lock is a decision about one payment, and
 * a stale one restored into a later send would lock someone else's money to
 * yesterday's recipient. `clearPaymentContext` drops it at the root of every
 * payment flow for the same reason.
 *
 * It lives in a store rather than screen state for the reason `contactSendStore`
 * does: the amount body renders in two places (the route and inside the Nut
 * Drop radar), and the header that shows the lock belongs to whichever screen
 * is hosting it.
 */
interface SendLockDraft {
  /** The key the ecash will be locked to. */
  lockKey: string;
  /**
   * Whose key it is, when it is a person's. Absent for a lock to a bare wallet
   * receive key, which names nobody.
   */
  recipientPubkey?: string;
  /**
   * Which sheet choice this is. The unlock time is derived from it when the
   * send leaves, so a choice made a while ago still means what it said.
   */
  durationId: string;
  /**
   * Our own keyring key, the one a reclaim would sign with. Present for a
   * timed choice — NUT-11 refuses a locktime without it.
   */
  refundKey?: CashuP2pkPubkey;
  /** False when the lock key is our assumption rather than their declaration. */
  confirmed: boolean;
}

interface SendLockStore {
  draft: SendLockDraft | null;
  set: (draft: SendLockDraft) => void;
  clear: () => void;
}

export const useSendLockStore = create<SendLockStore>({
  name: 'useSendLockStore',
  scope: 'session',
})((set, get) => ({
  draft: null,
  set: (draft) => {
    storeLog.info('store.sendLock.set', {
      durationId: draft.durationId,
      hasRecipient: !!draft.recipientPubkey,
      hasRefundKey: !!draft.refundKey,
      confirmed: draft.confirmed,
    });
    set({ draft });
  },
  clear: () => {
    if (!get().draft) return;
    storeLog.info('store.sendLock.clear');
    set({ draft: null });
  },
}));
