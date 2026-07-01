/**
 * @fileoverview Per-person decrypt access route
 *
 * Thin route wrapper; param validation and orchestration live in the screen.
 */

import { SignerAppPersonScreen } from '@/features/nostrSigner';

export default function SignerAppPersonRoute() {
  return <SignerAppPersonScreen />;
}
