import { searchListState } from '@/shared/ui/composed/search/searchListState';

describe('searchListState', () => {
  it('rows on screen always win, whatever the status', () => {
    for (const status of ['loading', 'revalidating', 'ready', 'empty', 'error', 'idle'] as const) {
      expect(searchListState(status, 3, 5, 3)).toBe('rows');
    }
  });
  it('placeholders only for a first paint of a real query', () => {
    expect(searchListState('loading', 0, 5, 3)).toBe('placeholders');
    expect(searchListState('revalidating', 0, 5, 3)).toBe('placeholders');
    expect(searchListState('loading', 0, 2, 3)).toBe('nothing'); // 2-char query: no skeletons
  });
  it('a query the remote search will not take settles on "no results", not a blank list', () => {
    // Below the remote minimum: the local answer is the whole answer.
    expect(searchListState('idle', 0, 2, 3)).toBe('no-results');
    // Remote search off for this query (a build without it, or a payment string).
    expect(searchListState('idle', 0, 5, 3, 0)).toBe('no-results');
  });
  it('stays blank while a remote search is about to start (the debounce)', () => {
    expect(searchListState('idle', 0, 5, 3)).toBe('nothing');
    expect(searchListState('idle', 0, 0, 3)).toBe('nothing');
  });
  it('a settled empty answer is "no results"; a failure is an error', () => {
    expect(searchListState('empty', 0, 5, 3)).toBe('no-results');
    expect(searchListState('ready', 0, 5, 3)).toBe('no-results');
    expect(searchListState('error', 0, 5, 3)).toBe('error');
  });
});
