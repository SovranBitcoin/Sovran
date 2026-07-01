/**
 * @fileoverview Standalone Lightning send route.
 */

import { LightningSendRoute } from '@/features/send';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function LightningSendStandaloneRoute() {
  return (
    <FormSheetChrome title="Send Lightning">
      <LightningSendRoute where="app.lightningSend" />
    </FormSheetChrome>
  );
}
