import { create } from 'zustand';
import { paymentLog } from '@/shared/lib/logger';

type AmountInputMode = 'unit' | 'fiat';

interface AmountDraft {
  rawInput: string;
  inputMode: AmountInputMode;
  /**
   * The flow this draft belongs to (`entry.destination`, e.g. 'sendEcash' /
   * 'mintQuote' / 'meltQuote'). The restore only fires when the re-entered
   * amount screen reports the same destination, so an unrelated flow restart
   * never picks up a stale amount.
   */
  scope: string;
  /**
   * Active unit the draft was typed in. The restore only fires when the
   * re-entered screen is still on this unit — a mint change can flip the
   * unit (pickHighestBalanceUnit follow), and a "1.5" typed as dollars must
   * never replay into a sat keypad.
   */
  unit: string;
}

interface AmountDraftStore {
  pending: AmountDraft | null;
  stash: (draft: AmountDraft) => void;
  /** Return AND consume the pending draft iff it matches `scope` + `unit`; else null. */
  take: (scope: string, unit: string) => AmountDraft | null;
  clear: () => void;
}

/**
 * Carries the in-progress amount across the mint-selector round trip.
 *
 * The typed amount lives only as `rawInput` inside colada's per-session amount
 * manager — it is committed to the machine context only on `next`. Opening the
 * mint selector tears the amount session down and re-enters a FRESH amount step
 * after a mint change, so the keypad would otherwise blank. AmountFlowScreen
 * stashes the draft before `requestMintSelector()` and restores it on re-entry
 * via the same `setInput` action the keypad uses. Cleared at every flow root by
 * `clearPaymentContext` so a brand-new flow never restores a stale amount.
 */
export const useAmountDraftStore = create<AmountDraftStore>((set, get) => ({
  pending: null,
  stash: (draft) => {
    paymentLog.info('amount_draft.stash', {
      scope: draft.scope,
      unit: draft.unit,
      rawInputLength: draft.rawInput.length,
      inputMode: draft.inputMode,
    });
    set({ pending: draft });
  },
  take: (scope, unit) => {
    const p = get().pending;
    if (!p || p.scope !== scope || p.unit !== unit) {
      paymentLog.info('amount_draft.take_miss', {
        scope,
        unit,
        hasPending: !!p,
        pendingScope: p?.scope ?? null,
        pendingUnit: p?.unit ?? null,
        pendingRawInputLength: p?.rawInput.length ?? 0,
      });
      // A unit mismatch means the draft can never legally restore — drop it
      // so it can't linger and match a later same-scope entry.
      if (p && p.scope === scope) set({ pending: null });
      return null;
    }
    paymentLog.info('amount_draft.take_hit', {
      scope,
      unit,
      rawInputLength: p.rawInput.length,
      inputMode: p.inputMode,
    });
    set({ pending: null });
    return p;
  },
  clear: () => {
    const p = get().pending;
    paymentLog.info('amount_draft.clear', {
      hadPending: !!p,
      pendingScope: p?.scope ?? null,
      pendingRawInputLength: p?.rawInput.length ?? 0,
    });
    set({ pending: null });
  },
}));
