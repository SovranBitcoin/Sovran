/**
 * @fileoverview Standalone Onchain receive route.
 */

import { OnchainReceiveRoute } from '@/features/receive';
import { FormSheetChrome } from '@/shared/ui/composed/FormSheetChrome';

export default function OnchainReceiveStandaloneRoute() {
  return (
    <FormSheetChrome title="Receive Onchain">
      <OnchainReceiveRoute where="app.onchainReceive" />
    </FormSheetChrome>
  );
}
