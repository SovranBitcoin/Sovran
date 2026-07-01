import { AiChatScreen } from '@/features/ai';
import { LazyTabContent } from '@/shared/ui/composed/LazyTabContent';

export default function AiRoute() {
  return (
    <LazyTabContent tag="ai">
      <AiChatScreen />
    </LazyTabContent>
  );
}
