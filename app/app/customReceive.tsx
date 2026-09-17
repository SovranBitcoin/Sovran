/**
 * @fileoverview Standalone route for a custom NUT-04 payment method.
 */

import { CustomReceiveRoute } from '@/features/receive';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function CustomReceiveStandaloneRoute() {
  // The sheet title is generic: the method is only known once the entry is
  // decoded, and the route's own Stack.Screen then names it ("Receive PayPal").
  return (
    <FormSheetChrome title="Receive">
      <CustomReceiveRoute where="app.customReceive" />
    </FormSheetChrome>
  );
}
