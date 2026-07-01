import { NotificationsScreen } from '@/features/feed';
import { LazyTabContent } from '@/shared/ui/composed/LazyTabContent';

export default function NotificationsRoute() {
  return (
    <LazyTabContent tag="notifications">
      <NotificationsScreen />
    </LazyTabContent>
  );
}
