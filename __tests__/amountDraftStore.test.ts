/**
 * amountDraftStore carries the typed amount across the mint-selector round trip.
 * `take` must be scope-gated (so an unrelated flow can't restore another flow's
 * amount) and single-shot (consumed on read), and `clear` must drop it.
 */
import { useAmountDraftStore } from '@/shared/stores/runtime/amountDraftStore';

beforeEach(() => useAmountDraftStore.getState().clear());

describe('amountDraftStore', () => {
  it('returns and consumes the draft only when the scope matches', () => {
    useAmountDraftStore
      .getState()
      .stash({ rawInput: '1234', inputMode: 'sat', scope: 'sendEcash' });

    // Wrong scope: not returned, not consumed.
    expect(useAmountDraftStore.getState().take('mintQuote')).toBeNull();
    expect(useAmountDraftStore.getState().pending).not.toBeNull();

    // Matching scope: returned once...
    expect(useAmountDraftStore.getState().take('sendEcash')).toEqual({
      rawInput: '1234',
      inputMode: 'sat',
      scope: 'sendEcash',
    });
    // ...then consumed.
    expect(useAmountDraftStore.getState().take('sendEcash')).toBeNull();
    expect(useAmountDraftStore.getState().pending).toBeNull();
  });

  it('clear() drops a pending draft', () => {
    useAmountDraftStore.getState().stash({ rawInput: '50', inputMode: 'fiat', scope: 'meltQuote' });
    useAmountDraftStore.getState().clear();
    expect(useAmountDraftStore.getState().take('meltQuote')).toBeNull();
  });
});
