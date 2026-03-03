import { router } from 'expo-router';

import { TermsAndConditionsScreen } from '@/features/onboarding';

export default function TermsRoute() {
  return <TermsAndConditionsScreen onClose={() => router.back()} />;
}
