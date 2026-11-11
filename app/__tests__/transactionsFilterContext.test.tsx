import TestRenderer, { act } from 'react-test-renderer';
import {
  TransactionsFilterProvider,
  useTransactionsFilter,
} from '@/features/transactions/components/TransactionsFilterContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/lib/logger', () => ({ cashuLog: { info: jest.fn() } }));

let filter: ReturnType<typeof useTransactionsFilter>;
function Probe() {
  filter = useTransactionsFilter();
  return null;
}

let renderer: TestRenderer.ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
});

// The filter sheet offers Reset for any currency other than sats; the header badge
// must agree, or a currency-only filter is applied with nothing showing it.
it('counts a currency-only filter as active, as the filter sheet does', () => {
  act(() => {
    renderer = TestRenderer.create(
      <TransactionsFilterProvider>
        <Probe />
      </TransactionsFilterProvider>
    );
  });
  expect(filter.activeFilterCount).toBe(0);

  act(() => filter.updateFilters({ currency: 'usd' }));
  expect(filter.activeFilterCount).toBe(1);

  act(() => filter.updateFilters({ paymentType: 'lightning' }));
  expect(filter.activeFilterCount).toBe(2);

  act(() => filter.updateFilters({ currency: 'sat', paymentType: 'all' }));
  expect(filter.activeFilterCount).toBe(0);
});
