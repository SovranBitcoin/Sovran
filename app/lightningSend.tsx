/**
 * @fileoverview Standalone Lightning send route.
 */

import { LightningSendRoute } from '@/features/send';

export default function LightningSendStandaloneRoute() {
  return <LightningSendRoute where="app.lightningSend" />;
}
