import { SearchLayout } from '@/shared/ui/composed/SearchLayout';

export default function SearchTabLayout() {
  return (
    <SearchLayout
      title="Search"
      placeholder="People, mints or places"
      searchTestID="search-input"
    />
  );
}
