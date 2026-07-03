/**
 * amountDraftStore carries the typed amount across the mint-selector round trip.
 * `take` must be scope- AND unit-gated (so an unrelated flow can't restore
 * another flow's amount, and a draft typed as dollars never replays into a sat
 * keypad) and single-shot (consumed on read), and `clear` must drop it.
 */
import { useAmountDraftStore } from '@/shared/stores/runtime/amountDraftStore';

beforeEach(() => useAmountDraftStore.getState().clear());

describe('amountDraftStore', () => {
  it('returns and consumes the draft only when scope and unit match', () => {
    useAmountDraftStore
      .getState()
      .stash({ rawInput: '1234', inputMode: 'unit', scope: 'sendEcash', unit: 'sat' });

    // Wrong scope: not returned, not consumed.
    expect(useAmountDraftStore.getState().take('mintQuote', 'sat')).toBeNull();
    expect(useAmountDraftStore.getState().pending).not.toBeNull();

    // Matching scope + unit: returned once...
    expect(useAmountDraftStore.getState().take('sendEcash', 'sat')).toEqual({
      rawInput: '1234',
      inputMode: 'unit',
      scope: 'sendEcash',
      unit: 'sat',
    });
    // ...then consumed.
    expect(useAmountDraftStore.getState().take('sendEcash', 'sat')).toBeNull();
    expect(useAmountDraftStore.getState().pending).toBeNull();
  });

  it('drops the draft when the unit flipped across the round trip', () => {
    useAmountDraftStore
      .getState()
      .stash({ rawInput: '1.5', inputMode: 'unit', scope: 'mintQuote', unit: 'usd' });

    // Same scope but the mint change flipped the unit: never restored, and
    // dropped so it can't match a later same-scope entry either.
    expect(useAmountDraftStore.getState().take('mintQuote', 'sat')).toBeNull();
    expect(useAmountDraftStore.getState().pending).toBeNull();
  });

  it('clear() drops a pending draft', () => {
    useAmountDraftStore
      .getState()
      .stash({ rawInput: '50', inputMode: 'fiat', scope: 'meltQuote', unit: 'sat' });
    useAmountDraftStore.getState().clear();
    expect(useAmountDraftStore.getState().take('meltQuote', 'sat')).toBeNull();
  });
});
