import { act, renderHook } from '@testing-library/react-native';
import { useContactSearch } from '@/features/payments/hooks/useContactSearch';

const mockSearch = jest.fn();
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: undefined }) }), {
  virtual: true,
});
jest.mock('@/shared/lib/nostr/searchProfiles', () => ({
  searchProfilesViaFacade: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: jest.fn(),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({ seedLowConfidenceProfiles: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  jest.useRealTimers();
});

it('debounces normalized search for 600 ms, cancels typing immediately, and retries when typing returns to the same query', () => {
  const { rerender, unmount } = renderHook(
    ({ query }: { query: string }) => useContactSearch(query),
    {
      initialProps: { query: ' ALICE ' },
    }
  );
  act(() => {
    jest.advanceTimersByTime(599);
  });
  expect(mockSearch).not.toHaveBeenCalled();
  act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch.mock.calls[0][0].query).toBe('alice');
  const signal = mockSearch.mock.calls[0][0].signal as AbortSignal;
  rerender({ query: 'bob' });
  expect(signal.aborted).toBe(true);
  rerender({ query: ' ALICE ' });
  act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(mockSearch).toHaveBeenCalledTimes(2);
  unmount();
  expect(mockSearch.mock.calls[1][0].signal.aborted).toBe(true);
});
