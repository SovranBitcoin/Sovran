import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { TermsAndConditionsScreen } from '@/features/onboarding';

export default function TermsRoute() {
  return <TermsAndConditionsScreen onClose={() => router.back()} />;
}
