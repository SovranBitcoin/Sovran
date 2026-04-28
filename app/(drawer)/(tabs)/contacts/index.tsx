import { ContactsScreen } from '@/features/contacts';
import { LazyTabContent } from '@/shared/ui/composed/LazyTabContent';

// Defer the Contacts subtree until first focus — see LazyTabContent for why.
export default function ContactsRoute() {
  return (
    <LazyTabContent tag="contacts">
      <ContactsScreen />
    </LazyTabContent>
  );
}
