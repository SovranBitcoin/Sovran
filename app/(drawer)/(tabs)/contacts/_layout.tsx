import { SearchLayout } from '@/shared/ui/composed/SearchLayout';

export { useSearchContext } from '@/shared/ui/composed/SearchLayout';

export default function ContactsLayout() {
  return <SearchLayout title="Contacts" placeholder="Search contacts..." />;
}
