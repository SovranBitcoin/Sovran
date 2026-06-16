import {
  getTransactionActionDirection,
  getTransactionActionLabel,
} from '@/features/transactions/lib/transactionPresentation';

describe('transaction presentation labels', () => {
  it('maps protocol history types to user-facing send and receive labels', () => {
    expect(getTransactionActionLabel('mint')).toBe('Receive');
    expect(getTransactionActionLabel('receive')).toBe('Receive');
    expect(getTransactionActionLabel('melt')).toBe('Send');
    expect(getTransactionActionLabel('send')).toBe('Send');
  });

  it('maps protocol history types to display directions', () => {
    expect(getTransactionActionDirection('mint')).toBe('receive');
    expect(getTransactionActionDirection('receive')).toBe('receive');
    expect(getTransactionActionDirection('melt')).toBe('send');
    expect(getTransactionActionDirection('send')).toBe('send');
  });
});
