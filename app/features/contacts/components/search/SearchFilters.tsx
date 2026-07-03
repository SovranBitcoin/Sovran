import React from 'react';

import { PillTabs, PILL_TABS_HEIGHT } from '@/shared/ui/composed/PillTabs';

export const SEARCH_FILTERS_HEIGHT = PILL_TABS_HEIGHT;

export type ContactsFilter = 'All' | 'Recent' | 'Requests' | 'Mints' | 'Groups';

const BASE_FILTERS: readonly ContactsFilter[] = ['All', 'Recent', 'Requests', 'Mints'];

type SearchFiltersProps = {
  activeFilter: ContactsFilter;
  onFilterChange: (filter: ContactsFilter) => void;
  /**
   * Filters to display, in order. Defaults to the base set.
   * The parent owns visibility rules — during search it can narrow this
   * list to only pills that have matches for the current query.
   */
  filters?: readonly ContactsFilter[];
  /**
   * Extra pills rendered inline at the end of the same scrollable row.
   */
  trailing?: React.ReactElement | null;
};

/** Contacts-flavored `PillTabs` — the shared pill row with the contacts
 *  filter vocabulary. */
export const SearchFilters = ({
  activeFilter,
  onFilterChange,
  filters = BASE_FILTERS,
  trailing = null,
}: SearchFiltersProps) => (
  <PillTabs
    tabs={filters}
    activeTab={activeFilter}
    onTabChange={onFilterChange}
    trailing={trailing}
  />
);
