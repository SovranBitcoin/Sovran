import { create } from 'zustand';

import { storeLog } from '@/shared/lib/logger';
import type { CashuP2pkPubkey } from '@/shared/lib/protocolIds';

/**
 * The lock the user chose for the send they are composing.
 *
 * Runtime only — never persisted. A lock is a decision about one payment, and
 * a stale one restored into a later send would lock someone else's money to
 * yesterday's recipient.
 *
 * It lives in a store rather than screen state for the reason `contactSendStore`
 * does: the amount body renders in two places (the route and inside the Nut
 * Drop radar), the header that owns the toggle renders in only one of them,
 * and `sendComplete` — a step handler outside React — has to read the terms to
 * record what was agreed.
 */
interface SendLockDraft {
  /** The key the ecash will be locked to. */
  lockKey: CashuP2pkPubkey;
  /** Whose key it is, so the annotation can name the counterparty. */
  recipientPubkey: string;
  /** Which menu choice produced this, so the menu can show it selected. */
  durationId: string;
  /** Unix seconds; absent means a permanent lock with no way back. */
  locktimeSec?: number;
  /**
   * Our own keyring key, the one a reclaim would sign with. Present exactly
   * when `locktimeSec` is — NUT-11 refuses one without the other.
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

export const useSendLockStore = create<SendLockStore>((set, get) => ({
  draft: null,
  set: (draft) => {
    storeLog.info('store.sendLock.set', {
      durationId: draft.durationId,
      hasLocktime: !!draft.locktimeSec,
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
