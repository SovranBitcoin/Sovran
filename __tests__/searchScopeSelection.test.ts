/**
 * @jest-environment node
 *
 * Guards the single-selection invariant of the unified search surface. The old
 * Contacts bug had TWO independent selection states on screen at once — the
 * category 'All' pill and the People/Posts toggle — which could both highlight.
 * The unified design collapses these into one `selectedScope` axis, so exactly
 * one tab can ever read as selected. These tests pin that property.
 */
import {
  ALL_SCOPES,
  computeVisibleScopes,
  resolveSelectedScope,
  type SearchScopeCounts,
} from '@/shared/ui/composed/search/scopes';

const ZERO: SearchScopeCounts = { people: 0, posts: 0, mints: 0, groups: 0 };

describe('unified search scope selection', () => {
  it('shows the full scope row for an empty query', () => {
    expect(computeVisibleScopes('', ZERO)).toEqual([...ALL_SCOPES]);
  });

  it('always includes All, and only non-empty scopes, for a query', () => {
    expect(computeVisibleScopes('lon', ZERO)).toEqual(['All']);
    expect(computeVisibleScopes('lon', { people: 2, posts: 2, mints: 0, groups: 0 })).toEqual([
      'All',
      'People',
      'Posts',
    ]);
    expect(computeVisibleScopes('lon', { people: 0, posts: 0, mints: 1, groups: 3 })).toEqual([
      'All',
      'Mints',
      'Groups',
    ]);
  });

  it('keeps the selection inside the visible set, falling back to All', () => {
    const visible = computeVisibleScopes('lon', { people: 1, posts: 1, mints: 0, groups: 0 });
    expect(resolveSelectedScope(visible, 'People')).toBe('People');
    // Mints tab isn't visible for this query → fall back to All.
    expect(resolveSelectedScope(visible, 'Mints')).toBe('All');
  });

  it('never highlights more than one tab, for any query / counts / prior selection', () => {
    const countSets: SearchScopeCounts[] = [
      ZERO,
      { people: 3, posts: 3, mints: 0, groups: 0 },
      { people: 0, posts: 0, mints: 2, groups: 0 },
      { people: 1, posts: 1, mints: 1, groups: 1 },
      { people: 0, posts: 0, mints: 0, groups: 5 },
    ];
    for (const query of ['', 'lon', 'a']) {
      for (const counts of countSets) {
        const visible = computeVisibleScopes(query, counts);
        for (const prior of ALL_SCOPES) {
          const selected = resolveSelectedScope(visible, prior);
          // The resolved selection is always a visible tab...
          expect(visible).toContain(selected);
          // ...and exactly one visible tab matches it. SearchScopeTabs renders
          // `active = scope === selected`, so this is "exactly one pill lit".
          expect(visible.filter((scope) => scope === selected)).toHaveLength(1);
        }
      }
    }
  });
});
