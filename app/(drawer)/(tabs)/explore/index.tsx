import { ExploreScreen } from '@/features/explore';
import { LazyTabContent } from '@/shared/ui/composed/LazyTabContent';

// Defer the Explore subtree until first focus — see LazyTabContent for why.
export default function ExploreRoute() {
  return (
    <LazyTabContent tag="explore">
      <ExploreScreen />
    </LazyTabContent>
  );
}
