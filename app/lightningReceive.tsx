/**
 * @fileoverview Standalone Lightning receive route.
 */

import { LightningReceiveRoute } from '@/features/receive';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function LightningReceiveStandaloneRoute() {
  return (
    <FormSheetChrome title="Receive Lightning">
      <LightningReceiveRoute where="app.lightningReceive" />
    </FormSheetChrome>
  );
}
