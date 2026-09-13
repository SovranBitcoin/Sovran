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
    expect(searchListState('idle', 0, 2, 3)).toBe('nothing');
  });
  it('a settled empty answer is "no results"; a failure is an error', () => {
    expect(searchListState('empty', 0, 5, 3)).toBe('no-results');
    expect(searchListState('ready', 0, 5, 3)).toBe('no-results');
    expect(searchListState('error', 0, 5, 3)).toBe('error');
  });
});
