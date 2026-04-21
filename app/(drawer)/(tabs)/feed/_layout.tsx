import { SearchLayout } from '@/shared/ui/composed/SearchLayout';

export { useSearchContext } from '@/shared/ui/composed/SearchLayout';

export default function FeedLayout() {
  return <SearchLayout title="Feed" placeholder="Search people..." />;
}
