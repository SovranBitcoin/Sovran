/**
 * @fileoverview Pure scope logic for the unified search surface.
 *
 * Kept free of React Native imports so the single-selection invariant can be
 * unit-tested directly. The whole point of the unified surface is that there is
 * exactly ONE selection axis (`selectedScope`); these helpers compute which
 * tabs are visible and keep the selection inside that set, so two tabs can never
 * read as selected at once.
 */

import { hasFeature, type Feature } from '@/shared/config/features';

/** Stable scope identifiers shared across all surfaces. */
export type SearchScopeId = 'All' | 'People' | 'Posts' | 'Mints' | 'Groups';

/** The full scope set, identical on every surface. Empty scopes are hidden. */
export const ALL_SCOPES: readonly SearchScopeId[] = ['All', 'People', 'Posts', 'Mints', 'Groups'];

/** The module a scope belongs to (ADR 0021); unlisted scopes always ship. */
const SCOPE_FEATURE: Partial<Record<SearchScopeId, Feature>> = { Posts: 'feed' };

export type SearchScopeCounts = {
  people: number;
  posts: number;
  mints: number;
  groups: number;
};

/**
 * Which scope tabs to show for the current query. `All` is always present; the
 * rest appear only when they have results. An empty query shows the full row
 * (recents render beneath it).
 */
export function computeVisibleScopes(
  query: string,
  counts: SearchScopeCounts,
  enabled: (feature: Feature) => boolean = hasFeature
): SearchScopeId[] {
  const shipped = ALL_SCOPES.filter((scope) => {
    const feature = SCOPE_FEATURE[scope];
    return !feature || enabled(feature);
  });
  if (!query) return shipped;
  return shipped.filter((scope) => {
    switch (scope) {
      case 'All':
        return true;
      case 'People':
        return counts.people > 0;
      case 'Posts':
        return counts.posts > 0;
      case 'Mints':
        return counts.mints > 0;
      case 'Groups':
        return counts.groups > 0;
    }
  });
}

/**
 * Keep the selection inside the visible set. If the active scope's tab has
 * disappeared, fall back to `All` (always present). This is the only reset
 * path — there is no second selection axis to desync from.
 */
export function resolveSelectedScope(
  visibleScopes: readonly SearchScopeId[],
  selected: SearchScopeId
): SearchScopeId {
  return visibleScopes.includes(selected) ? selected : 'All';
}
