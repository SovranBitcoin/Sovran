import {
  assertNever,
  hasViewStateData,
  matchViewState,
  toViewState,
  viewStateData,
  type ViewState,
} from '@/shared/lib/viewState';

const label = (state: ViewState<number[]>) =>
  matchViewState(state, {
    loading: () => 'loading',
    empty: () => 'empty',
    error: (error) => `error:${String(error)}`,
    ready: (data) => `ready:${data.length}`,
    refreshing: (data) => `refreshing:${data.length}`,
    stale: (data, error) => `stale:${data.length}:${String(error)}`,
  });

describe('matchViewState', () => {
  it('calls the handler for each of the six states', () => {
    expect(label({ status: 'loading' })).toBe('loading');
    expect(label({ status: 'empty' })).toBe('empty');
    expect(label({ status: 'error', error: 'boom' })).toBe('error:boom');
    expect(label({ status: 'ready', data: [1] })).toBe('ready:1');
    expect(label({ status: 'refreshing', data: [1, 2] })).toBe('refreshing:2');
    expect(label({ status: 'stale', data: [1], error: 'late' })).toBe('stale:1:late');
  });

  it('throws on a state it does not know', () => {
    const unknown: unknown = { status: 'nope' };
    expect(() => label(unknown as ViewState<number[]>)).toThrow('Unknown view state');
    expect(() => assertNever('x' as never)).toThrow('Unexpected value: "x"');
  });
});

describe('viewStateData', () => {
  it('returns data only for the states that hold it', () => {
    expect(viewStateData({ status: 'ready', data: 1 })).toBe(1);
    expect(viewStateData({ status: 'refreshing', data: 2 })).toBe(2);
    expect(viewStateData({ status: 'stale', data: 3 })).toBe(3);
    expect(viewStateData({ status: 'loading' })).toBeUndefined();
    expect(viewStateData({ status: 'empty' })).toBeUndefined();
    expect(viewStateData({ status: 'error', error: 'x' })).toBeUndefined();
    expect(hasViewStateData({ status: 'ready', data: 0 })).toBe(true);
  });
});

describe('toViewState', () => {
  it('shows the skeleton only for a first load with nothing yet', () => {
    expect(toViewState({ data: undefined, isLoading: true })).toEqual({ status: 'loading' });
    expect(toViewState({ data: [], isLoading: true })).toEqual({ status: 'loading' });
  });

  it('keeps showing loaded data while it reloads or after a reload fails', () => {
    expect(toViewState({ data: [1], isLoading: true })).toEqual({
      status: 'refreshing',
      data: [1],
    });
    expect(toViewState({ data: [1], error: 'x' })).toEqual({
      status: 'stale',
      data: [1],
      error: 'x',
    });
    expect(toViewState({ data: [1], stale: true })).toEqual({ status: 'stale', data: [1] });
    expect(toViewState({ data: [1] })).toEqual({ status: 'ready', data: [1] });
  });

  it('separates nothing-there from failed', () => {
    expect(toViewState({ data: [] })).toEqual({ status: 'empty' });
    expect(toViewState({ data: undefined, error: 'x' })).toEqual({ status: 'error', error: 'x' });
    expect(toViewState({ data: { n: 0 }, isEmpty: (d) => d.n === 0 })).toEqual({
      status: 'empty',
    });
  });
});
