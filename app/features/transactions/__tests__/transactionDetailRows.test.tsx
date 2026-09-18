import {
  amountDetailItem,
  stateDetailItem,
  quoteIdDetailItem,
  mintDetailItem,
} from '../components/detail/transactionDetailRows';
import { formatAmount } from '@/shared/lib/currency';
import { CopyableValue } from '@/shared/ui/composed/CopyableValue';
import { MiddleEllipsisValue } from '@/shared/ui/composed/MiddleEllipsisValue';

jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn() }));

describe('transactionDetailRows', () => {
  it('amountDetailItem formats through the shared currency formatter', () => {
    expect(amountDetailItem({ amount: 21, unit: 'sat' })).toEqual({
      title: 'Amount',
      value: formatAmount({ amount: 21, unit: 'sat' }),
    });
  });

  it('stateDetailItem passes the resolved state through', () => {
    expect(stateDetailItem('PAID')).toEqual({ title: 'State', value: 'PAID' });
  });

  it('quoteIdDetailItem renders the full quote id as a copyable value', () => {
    const quoteId = 'melt-quote-0123456789abcdef';
    const item = quoteIdDetailItem(quoteId);
    expect(item?.title).toBe('Quote ID');
    const value = item?.value;
    expect(value?.type).toBe(CopyableValue);
    expect(value?.props).toEqual({ value: quoteId, copyTarget: 'quoteId' });
  });

  it('quoteIdDetailItem and mintDetailItem gate on their optional value', () => {
    expect(quoteIdDetailItem(undefined)).toBeNull();
    expect(mintDetailItem(undefined)).toBeNull();
    expect(mintDetailItem(null)).toBeNull();
  });

  it('mintDetailItem shows the full mint url, elided only on screen', () => {
    const mintUrl = 'https://mint.example.sovran.money/api/v1';
    const item = mintDetailItem(mintUrl);
    expect(item?.title).toBe('Mint');
    expect(item?.value.type).toBe(MiddleEllipsisValue);
    expect(item?.value.props).toEqual({ value: mintUrl });
  });
});
