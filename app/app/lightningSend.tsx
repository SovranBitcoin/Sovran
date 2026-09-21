/**
 * @fileoverview Standalone Lightning send route.
 */

import { LightningSendRoute } from '@/features/send';
import { railHeaderTitle } from 'wallet';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function LightningSendStandaloneRoute() {
  return (
    <FormSheetChrome title={railHeaderTitle('lightningSend')}>
      <LightningSendRoute where="app.lightningSend" />
    </FormSheetChrome>
  );
}
