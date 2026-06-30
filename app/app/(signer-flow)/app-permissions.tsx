/**
 * @fileoverview Fine-grained per-action permissions route
 *
 * Thin route wrapper; param validation and orchestration live in the screen.
 */

import { SignerAppPermissionsScreen } from '@/features/nostrSigner';

export default function SignerAppPermissionsRoute() {
  return <SignerAppPermissionsScreen />;
}
